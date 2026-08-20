"""Virtual-camera re-projection — the angle-agnostic seam.

The problem this solves
-----------------------
`biomech2d` measures sagittal angles in the IMAGE plane, so every metric it
produces is only as good as the camera's alignment with the plane that metric
lives in. The existing response is a confidence discount (`_viewpoint_penalty`,
`sin²`/`cos²` of the estimated azimuth): a metric measured off-axis is reported
less confidently. That is honest, but it is a label on a biased number — a
scalar discount cannot recover an angle that perspective has compressed, and the
bias does not average out across frames.

The fix is to stop measuring in the camera's frame at all. Given a 3D skeleton in
a gravity-aligned world frame we can:

  1. derive a CANONICAL orientation from the athlete's own body + gravity
     (running direction = +X, gravity up = +Y, lateral = +Z),
  2. rotate every frame into it, and
  3. re-project through a VIRTUAL camera placed exactly on-axis for the plane
     we want to measure.

Every metric is then read from its own ideal viewpoint. Sagittal metrics come
from a virtual side view (azimuth exactly 0°), frontal metrics — knee valgus,
pelvic drop — from a virtual front view (azimuth exactly 90°). The viewpoint
penalty is not merely small, it is zero BY CONSTRUCTION, because we chose the
camera. `estimate_azimuth_from_keypoints` becomes unnecessary on this path.

Why re-project into 2D instead of computing angles in 3D
--------------------------------------------------------
Because `biomech2d`'s metric layer is the best-tested code in the repo — 11
metrics with plausibility envelopes, robust-fallback statistics, phase-specific
norms, a weighted form score, and the flaw/focus-area split. The dormant
TypeScript 3D metric layer computes 5 metrics, a strict subset, with no
plausibility gate. Re-projecting lets every one of those 11 metrics become
angle-agnostic without touching a single metric formula.

Why the canonical rotation here is CLIP-STABLE, unlike stage4_canonicalize.ts
-----------------------------------------------------------------------------
`stage4_canonicalize.ts` builds a PER-FRAME, pelvis-centric basis. That is
correct for reading joint angles, which is all Stage 5 uses it for. It is wrong
as a re-projection transform: pinning the pelvis to the origin every frame
deletes the athlete's vertical travel, and `vertical_oscillation` is exactly
that travel. So this module applies ONE rigid rotation for the whole clip and
preserves vertical translation. Both constructions are legitimate; they answer
different questions.

Coordinate conventions (easy to get wrong, so stated explicitly)
---------------------------------------------------------------
* World input: right-handed, metric or scale-normalized, `up_world` is the
  measured gravity direction. Absolute yaw is arbitrary — a monocular lift has
  no way to know true north — which is precisely why heading is re-derived from
  the body below.
* Canonical: `e_x` = running direction (horizontal), `e_y` = gravity up,
  `e_z` = cross(e_x, e_y) = lateral. Right-handed.
* Output: the `pose_backend` frame contract — keypoints `(17, 3)` as
  `[y, x, confidence]`, normalized, y increasing DOWNWARD (image convention).
  Because gravity is mapped onto the image vertical by construction, the
  caller should pass `image_down=(1.0, 0.0)` to `analyze_2d_sagittal_stream`.
"""

from __future__ import annotations

from typing import Any, Iterable, Literal

import numpy as np

from src.canonical_2d import CANON_KP as KP, NUM_CANON

View = Literal["side", "front"]

# Fraction of frame height the athlete's torso should occupy after projection.
# Only the RATIO matters to biomech2d (every metric is an angle or a normalized
# ratio), but a stable, realistic value keeps synthetic frames in the same
# numeric range as real ones so shared thresholds behave identically.
TARGET_TORSO_FRAC = 0.29

# Clip is unusable if fewer than this fraction of frames yield a valid pose.
MIN_VALID_FRAC = 0.25

# A frame needs this many finite core joints (hips/shoulders/knees/ankles) to be
# worth projecting; below it the canonical basis is not determinable.
_CORE = ["left_hip", "right_hip", "left_shoulder", "right_shoulder",
         "left_knee", "right_knee", "left_ankle", "right_ankle"]
_MIN_CORE = 6


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else v


def _finite_rows(pose: np.ndarray) -> np.ndarray:
    """Boolean mask of joints with all-finite coordinates."""
    return np.isfinite(pose).all(axis=1)


def gravity_up(up_world: Iterable[float] | None) -> np.ndarray:
    """Resolve the world up axis, defaulting to +Y.

    Mirrors `resolveUp` in stage4_canonicalize.ts. Passing a MEASURED gravity
    (from the phone IMU, via the complementary filter in gravity.ts) is what
    makes the result invariant to camera pitch and roll, not just yaw."""
    default = np.array([0.0, 1.0, 0.0])
    if up_world is None:
        return default
    u = _unit(np.asarray(up_world, dtype=float).reshape(3))
    return u if np.linalg.norm(u) > 1e-6 else default


def heading_from_poses(poses: np.ndarray, up: np.ndarray) -> np.ndarray:
    """Running direction as a horizontal unit vector in the world frame.

    Two independent estimates, in preference order:

    1. **Pelvis travel.** Net horizontal displacement of the hip midpoint from
       the first to the last valid frame. This is the honest read: it uses the
       athlete's actual motion and is immune to how they happen to be oriented.
    2. **Hip-line normal.** A runner faces perpendicular to their hip line, so
       `cross(up, hip_line)` gives facing. Used when travel is too small to
       trust — a treadmill clip, a drill in place, or a very short capture.

    Both are flattened against gravity so a leaning athlete does not tilt the
    heading. Returns a zero vector only if the pose data is degenerate."""
    valid = [i for i in range(len(poses)) if _finite_rows(poses[i])[[KP["left_hip"], KP["right_hip"]]].all()]
    if not valid:
        return np.zeros(3)

    pelvis = np.array([(poses[i][KP["left_hip"]] + poses[i][KP["right_hip"]]) / 2.0 for i in valid])

    # (1) travel, with the vertical component removed
    travel = pelvis[-1] - pelvis[0]
    travel = travel - up * float(np.dot(travel, up))
    # Scale-free significance test: compare travel against the athlete's own
    # torso length so this works in metric OR normalized units.
    torso = _median_torso_3d(poses)
    if torso > 1e-9 and float(np.linalg.norm(travel)) > 0.5 * torso:
        return _unit(travel)

    # (2) hip-line normal, median over frames so a single bad frame can't swing it
    normals = []
    for i in valid:
        hip_line = poses[i][KP["right_hip"]] - poses[i][KP["left_hip"]]
        hip_line = hip_line - up * float(np.dot(hip_line, up))
        if float(np.linalg.norm(hip_line)) < 1e-9:
            continue
        normals.append(_unit(np.cross(up, _unit(hip_line))))
    if not normals:
        return np.zeros(3)
    # Sign-align to the first normal before averaging: the hip line has no
    # inherent left/right sense, so raw averaging can cancel to zero.
    ref = normals[0]
    aligned = [n if float(np.dot(n, ref)) >= 0 else -n for n in normals]
    return _unit(np.median(np.array(aligned), axis=0))


def _median_torso_3d(poses: np.ndarray) -> float:
    """Median 3D shoulder-midpoint to hip-midpoint distance across the clip."""
    lens = []
    for p in poses:
        f = _finite_rows(p)
        if not (f[KP["left_shoulder"]] and f[KP["right_shoulder"]]
                and f[KP["left_hip"]] and f[KP["right_hip"]]):
            continue
        ms = (p[KP["left_shoulder"]] + p[KP["right_shoulder"]]) / 2.0
        mh = (p[KP["left_hip"]] + p[KP["right_hip"]]) / 2.0
        lens.append(float(np.linalg.norm(ms - mh)))
    return float(np.median(lens)) if lens else 0.0


def canonical_rotation(poses: np.ndarray, up_world: Iterable[float] | None = None) -> np.ndarray:
    """3x3 rotation mapping world coordinates into the canonical frame.

    Rows are the canonical basis vectors, so `canonical = R @ world_vector`.
    Raises ValueError when heading cannot be determined — better to fail loudly
    than to silently re-project through an arbitrary frame, which would produce
    plausible-looking angles measured in no particular plane."""
    up = gravity_up(up_world)
    heading = heading_from_poses(poses, up)
    if float(np.linalg.norm(heading)) < 1e-6:
        raise ValueError("indeterminate_heading")
    e_x = _unit(heading - up * float(np.dot(heading, up)))
    e_y = up
    e_z = _unit(np.cross(e_x, e_y))
    # Re-orthogonalize so the basis is exact even if `up` and heading drifted
    # slightly out of perpendicular (same guard as bodyBasis in stage 4).
    e_y = _unit(np.cross(e_z, e_x))
    return np.vstack([e_x, e_y, e_z])


def _plane_axes(view: View) -> tuple[int, int]:
    """(horizontal_axis, vertical_axis) indices into canonical coordinates.

    side  — sagittal plane: running direction (X) across, gravity (Y) up.
            The lateral axis Z becomes the view axis, so mediolateral spans
            collapse to zero, which is exactly what azimuth 0° means.
    front — frontal plane: lateral (Z) across, gravity (Y) up. The running
            axis X becomes the view axis: azimuth 90°.
    """
    if view == "side":
        return 0, 1
    if view == "front":
        return 2, 1
    raise ValueError(f"unknown view {view!r} (expected 'side' or 'front')")


def reproject(
    poses: np.ndarray,
    confidences: np.ndarray,
    view: View,
    up_world: Iterable[float] | None = None,
    frame_indices: Iterable[int] | None = None,
    rotation: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    """Re-project a 3D pose sequence through a virtual on-axis camera.

    Parameters
    ----------
    poses         (N, 17, 3) world-frame joints in COCO-17 order. NaN = absent.
    confidences   (N, 17) per-joint confidence, carried through from the source
                  2D detector: a joint the detector never saw is a joint the
                  lifter guessed, and downstream trust must know that.
    view          'side' for sagittal metrics, 'front' for frontal metrics.
    up_world      measured gravity direction; defaults to +Y.
    rotation      precomputed canonical rotation. Pass the SAME rotation for
                  both views of one clip so the two passes agree.

    Returns a list of frame dicts matching the `pose_backend` contract, ready
    for `analyze_2d_sagittal_stream` with no adaptation.

    Projection is ORTHOGRAPHIC on purpose. A perspective virtual camera would
    reintroduce the foreshortening this whole module exists to remove; since
    every downstream metric is an angle or a hip-normalized ratio, orthographic
    is both geometrically pure and simpler.
    """
    poses = np.asarray(poses, dtype=float)
    confidences = np.asarray(confidences, dtype=float)
    if poses.ndim != 3 or poses.shape[1:] != (NUM_CANON, 3):
        raise ValueError(f"poses must be (N, {NUM_CANON}, 3), got {poses.shape}")
    if confidences.shape != poses.shape[:2]:
        raise ValueError(f"confidences must be {poses.shape[:2]}, got {confidences.shape}")

    R = canonical_rotation(poses, up_world) if rotation is None else np.asarray(rotation, float)
    h_ax, v_ax = _plane_axes(view)
    idxs = list(frame_indices) if frame_indices is not None else list(range(len(poses)))

    # Rotate every frame once. NaNs propagate through the matmul untouched.
    canon = poses @ R.T  # (N, 17, 3)

    core_ids = [KP[n] for n in _CORE]
    valid = np.array([
        int(np.isfinite(canon[i][core_ids]).all(axis=1).sum()) >= _MIN_CORE
        for i in range(len(canon))
    ])
    if valid.sum() < max(1, MIN_VALID_FRAC * len(canon)):
        raise ValueError("low_confidence_video")

    # ── Clip-stable scale and offset ──────────────────────────────────────────
    # Both are computed ONCE over the clip, never per frame. A per-frame
    # normalization would rescale the athlete every frame and destroy exactly
    # the signals that depend on absolute vertical travel — vertical_oscillation
    # is hip height range, and it would collapse to zero.
    pelvis = np.full((len(canon), 3), np.nan)
    for i in range(len(canon)):
        f = _finite_rows(canon[i])
        if f[KP["left_hip"]] and f[KP["right_hip"]]:
            pelvis[i] = (canon[i][KP["left_hip"]] + canon[i][KP["right_hip"]]) / 2.0

    torso = _median_torso_3d(canon)
    if torso < 1e-9:
        raise ValueError("degenerate_torso")
    scale = TARGET_TORSO_FRAC / torso

    # Vertical: one clip-level datum, so real bounce survives as deviation.
    v_ref = float(np.nanmedian(pelvis[:, v_ax])) if np.isfinite(pelvis[:, v_ax]).any() else 0.0

    frames: list[dict[str, Any]] = []
    for i in range(len(canon)):
        kp = np.zeros((NUM_CANON, 3), dtype=float)
        if not valid[i] or not np.isfinite(pelvis[i]).all():
            frames.append({
                "frame_index": int(idxs[i]) if i < len(idxs) else i,
                "keypoints": kp, "avg_confidence": 0.0, "excluded": True,
            })
            continue

        # Horizontal: track the pelvis, so the athlete stays framed the way a
        # panning operator would keep them. Every horizontal metric downstream
        # (overstride) is hip-relative anyway, so this changes no measurement —
        # it only keeps the projection in a sane numeric range.
        h = (canon[i][:, h_ax] - pelvis[i][h_ax]) * scale + 0.5
        # Vertical: image y grows DOWNWARD, so gravity-up must be negated.
        v = -(canon[i][:, v_ax] - v_ref) * scale + 0.5

        finite = _finite_rows(canon[i])
        kp[:, 0] = np.where(finite, v, 0.0)
        kp[:, 1] = np.where(finite, h, 0.0)
        kp[:, 2] = np.where(finite, confidences[i], 0.0)

        seen = kp[finite, 2]
        frames.append({
            "frame_index": int(idxs[i]) if i < len(idxs) else i,
            "keypoints": kp,
            "avg_confidence": float(np.mean(seen)) if seen.size else 0.0,
            "excluded": False,
            "keypoint_format": "coco17",
            "source_format": "coco17",
        })
    return frames
