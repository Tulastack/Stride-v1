"""Angle-agnostic analysis: one clip, two virtual cameras, one verdict.

This is the orchestration layer that makes `virtual_camera` useful. Given a 3D
skeleton in a gravity-aligned world frame it:

  1. derives ONE canonical rotation for the clip (athlete's running direction +
     measured gravity),
  2. re-projects through a virtual SIDE camera and reads the sagittal scalars,
  3. re-projects through a virtual FRONT camera and reads the frontal scalars,
  4. feeds the combined set into a SINGLE `_assemble`.

Why one `_assemble` rather than merging two results
---------------------------------------------------
Flaws, focus areas and the form score are all derived from the whole metric set
inside `_assemble`. Running it twice and stitching the outputs would mean
re-deriving the score, the FOCUS_TARGET cap and the flaw/focus split outside the
function that owns them — two implementations of the same policy, drifting. So
the scalar series are merged BEFORE assembly and the athlete is scored once.

What this fixes that the single-view path cannot
------------------------------------------------
`knee_valgus` and `pelvic_drop` are frontal-plane quantities. Measured from a
side-on clip, `_valgus` computes horizontal deviation of the knee from the
hip→ankle line — but in a sagittal image the horizontal axis is the
ANTEROPOSTERIOR axis, so it returns anterior knee displacement, a function of
knee flexion. That is not a degraded measurement of valgus; it is a different
quantity wearing the label. The single-view path can only respond by discounting
confidence, and a confidence discount cannot repair an invalid construct. Here
the frontal scalars come from a camera that is actually facing the athlete, so
the construct is right and the discount is unnecessary.

Honesty
-------
The viewpoint penalty really is zero on this path — we chose the camera, so
there is no off-axis foreshortening to model. That is stated as
`vp_override=0.0`. It would be easy and wrong to stop there: a monocular 3D
reconstruction carries its own error, which the azimuth term never described.
That rides separately in `recon_conf`, and it defaults to a value that keeps
every metric EXPERIMENTAL until a validation study exists. An ideal viewpoint
must not be allowed to launder an unvalidated reconstruction into a trusted
badge — that would repeat the exact defect this pipeline was built to remove,
where `reconResidual` was constant by construction yet fed a 0.91 confidence
multiplier straight to the user.
"""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np

from src.biomech2d import TRUST_CONF_MIN, _assemble, _collect_scalars
from src.canonical_2d import CANON_KP as KP
from src.virtual_camera import canonical_rotation, reproject

# Scalars that belong to the frontal plane and must be read from the front
# camera. Everything else in `_KEYS` is sagittal or view-independent.
FRONTAL_SCALARS = ("knee_valgus", "pelvic_drop")

# Gravity maps onto the image vertical by construction in a virtual camera, so
# "down" in the projected image is exactly +y. No IMU estimate needed here.
VIRTUAL_IMAGE_DOWN = (1.0, 0.0)

# Joints any metric in biomech2d actually reads. Confidence is averaged over
# THESE, not over all 17 canonical keypoints.
#
# `_frame_scalars` averages the whole COCO-17 array, so nose/eyes/ears — which
# no metric depends on — pull the number that gates every metric. On the 2D path
# that is merely imprecise. On this path it is systematic: 2D->3D lifters emit
# H36M-class joint sets with no eyes or ears, so those four slots arrive absent
# on EVERY clip and would depress confidence by ~24% forever. Measured on the
# synthetic fixture: 0.65 instead of 0.85, which dropped every metric below the
# 0.35 usability floor and produced a completely empty report.
METRIC_JOINTS = (
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)

# Reconstruction confidence to assume until a criterion-validity study exists.
#
# Sits JUST below TRUST_CONF_MIN, which gives two properties at once:
#   * no metric from a lifted skeleton can be certified trusted even with a
#     perfect detector, since recon_conf x 1.0 < TRUST_CONF_MIN; and
#   * a normally-confident clip still clears the 0.35 usability floor, so the
#     report is hedged focus areas rather than nothing at all.
# The second half matters. A floor so low that the pipeline emits an empty
# result is not caution, it is a broken feature wearing caution's clothes.
# Raise this only with measured limits of agreement in hand.
UNVALIDATED_RECON_CONF = round(TRUST_CONF_MIN - 0.01, 2)


def _metric_mean_conf(poses: np.ndarray, confidences: np.ndarray) -> float:
    """Mean detector confidence over the joints the metrics depend on.

    Absent joints (NaN in the 3D pose) are excluded rather than counted as zero:
    a joint the lifter never produced should not be evidence that the joints it
    DID produce are unreliable."""
    idx = [KP[n] for n in METRIC_JOINTS]
    finite = np.isfinite(poses[:, idx]).all(axis=2)
    vals = confidences[:, idx][finite]
    return float(np.mean(vals)) if vals.size else 0.0


def analyze_3d_angle_agnostic(
    poses: np.ndarray,
    confidences: np.ndarray,
    fps: float,
    up_world: Iterable[float] | None = None,
    frame_indices: Iterable[int] | None = None,
    recon_conf: float = UNVALIDATED_RECON_CONF,
    clip_id: str = "clip",
    source_fps: float | None = None,
    capture_fps: float | None = None,
    timing_signal: list | None = None,
    timing_fps: float | None = None,
    min_frames: int = 8,
    max_frames: int = 450,
) -> dict[str, Any]:
    """Run the two-pass virtual-camera analysis.

    `poses` (N, 17, 3) world-frame COCO-17 joints, `confidences` (N, 17) carried
    through from the source 2D detector.

    `timing_signal` is passed through UNCHANGED and is measured on the ORIGINAL
    clip, never on a re-projection. Cadence and ground contact come from the
    full-source-rate optical-flow ankle signal; re-projecting cannot add
    temporal resolution, and running them through a synthetic camera would only
    launder the pose sample rate into looking like the capture rate.
    """
    poses = np.asarray(poses, dtype=float)
    confidences = np.asarray(confidences, dtype=float)
    pose_fps = float(fps)
    src_fps = float(source_fps if source_fps is not None else pose_fps)
    cap_fps = float(capture_fps if capture_fps is not None else pose_fps)

    # One rotation, both views — otherwise the two passes describe the athlete
    # in two different frames and the merged scalars would not be commensurable.
    rotation = canonical_rotation(poses, up_world)

    side = reproject(poses, confidences, "side", rotation=rotation,
                     frame_indices=frame_indices)
    front = reproject(poses, confidences, "front", rotation=rotation,
                      frame_indices=frame_indices)

    common = dict(min_frames=min_frames, max_frames=max_frames,
                  src_fps=src_fps, image_down=VIRTUAL_IMAGE_DOWN,
                  estimate_azimuth=False)

    # azimuth is stated, never estimated: a virtual side camera IS 0 degrees and
    # a virtual front camera IS 90 degrees. The keypoint azimuth heuristic is
    # not merely unnecessary here, it is meaningless — there is no real camera.
    S_side, idxs, _, _, dropped_pct = _collect_scalars(iter(side), 0.0, **common)
    S_front, idxs_front, _, _, _ = _collect_scalars(iter(front), 90.0, **common)

    # Both views share one validity mask (it depends on the 3D pose being
    # finite, not on the projection), so the series must align frame for frame.
    if idxs_front != idxs:
        raise ValueError("virtual_camera_view_desync")

    S = dict(S_side)
    for key in FRONTAL_SCALARS:
        S[key] = S_front[key]

    return _assemble(
        S, idxs, pose_fps, _metric_mean_conf(poses, confidences), 0.0, clip_id,
        capture_fps=cap_fps, source_fps=src_fps,
        timing_signal=timing_signal, timing_fps=timing_fps,
        dropped_pct=dropped_pct,
        vp_override=0.0,          # honest: we chose the camera
        recon_conf=recon_conf,    # honest: the skeleton is still an estimate
    )
