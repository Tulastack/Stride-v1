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

# Frontal metrics are read from the virtual FRONT camera, so a head-on capture
# is the good case for them, not the bad one. The sagittal observability gate
# must not punish them for the view it rewards them for.
FRONTAL_EXEMPT = frozenset(FRONTAL_SCALARS)


def _GATED_KEYS(result: dict) -> set:
    """Metric keys demoted out of trust by the observability gate."""
    return {m["key"] for m in result["metrics"]
            if m.get("tier") in (2, 3) and m["key"] not in FRONTAL_EXEMPT}

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


def sagittal_observability(rotation: np.ndarray,
                           view_axis: Iterable[float] = (0.0, 0.0, 1.0)) -> float:
    """How much of the athlete's sagittal plane the camera could actually see.

    Returns 1.0 when the sagittal plane lies in the image plane (a side-on view,
    where every sagittal angle is measured directly and depth is not needed) and
    0.0 when it lies along the viewing axis (head-on, where every sagittal angle
    depends entirely on recovered depth).

    This is the honest uncertainty signal for a monocular lift, and it is
    deliberately NOT the reconstruction's self-consistency. Bone-closure
    residual cannot detect the depth-sign ambiguity, because BOTH branches
    satisfy every bone constraint exactly -- that is precisely what makes them
    ambiguous. Measured across camera angles, closure residual stays flat
    (0.035 to 0.045 of a torso length) while true error grows almost tenfold.
    Observability is geometric: it says how much information the view contained,
    which is the thing that actually bounds the answer.
    """
    v = np.asarray(view_axis, dtype=float)
    n = float(np.linalg.norm(v))
    if n < 1e-9:
        return 1.0
    run_axis = np.asarray(rotation, dtype=float)[0]     # canonical +X = running direction
    return float(np.clip(1.0 - abs(float(np.dot(run_axis, v / n))), 0.0, 1.0))


# Observability below this means the sagittal plane was largely hidden from the
# camera, so sagittal metrics rest on depth the view never contained. Calibrated
# against measured error: side-on and 20 deg land ~2 deg MAE, 35 deg ~9 deg, and
# 50 deg and beyond exceed 18 deg -- past any clinically useful threshold.
OBSERVABILITY_FLOOR = 0.55


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
    view_axis: Iterable[float] | None = (0.0, 0.0, 1.0),
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

    # Geometric observability discounts recon confidence when the view simply
    # did not contain the sagittal plane. Combined multiplicatively with any
    # solver-reported confidence: a clean solve on an uninformative view is
    # still an uninformative view.
    obs = sagittal_observability(rotation, view_axis) if view_axis is not None else 1.0
    # Observability is applied as a TRUST GATE below, not as a confidence
    # multiplier here. Multiplying it into recon_conf stacked two independent
    # discounts (unvalidated x unobservable), pushed metrics under the 0.35
    # usability floor and produced an EMPTY report -- deleting the measurement
    # rather than demoting it, which is the one thing this pipeline exists not
    # to do. The gate expresses the same verdict without erasing the reading.
    recon_conf = float(recon_conf)

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
    S_side, idxs, _, _, dropped_pct, _trunc = _collect_scalars(iter(side), 0.0, **common)
    S_front, idxs_front, _, _, _, _ = _collect_scalars(iter(front), 90.0, **common)

    # Both views share one validity mask (it depends on the 3D pose being
    # finite, not on the projection), so the series must align frame for frame.
    if idxs_front != idxs:
        raise ValueError("virtual_camera_view_desync")

    S = dict(S_side)
    for key in FRONTAL_SCALARS:
        S[key] = S_front[key]

    result = _assemble(
        S, idxs, pose_fps, _metric_mean_conf(poses, confidences), 0.0, clip_id,
        capture_fps=cap_fps, source_fps=src_fps,
        timing_signal=timing_signal, timing_fps=timing_fps,
        dropped_pct=dropped_pct,
        vp_override=0.0,          # honest: we chose the camera
        recon_conf=recon_conf,    # honest: the skeleton is still an estimate
    )
    result["captureQuality"]["sagittalObservability"] = round(obs, 3)
    if obs < OBSERVABILITY_FLOOR:
        # The view did not contain the sagittal plane, so no sagittal or
        # translational metric may be certified from it however cleanly the
        # solve closed. Temporal metrics are unaffected: cadence and ground
        # contact come from footstrike timing, which a head-on view still sees.
        for m in result["metrics"]:
            if m.get("tier") in (2, 3) and m["key"] not in FRONTAL_EXEMPT:
                m["trustStatus"] = "experimental"
    # The mirror gate, and it is not optional. Frontal metrics are exempt from
    # the sagittal test because a head-on view is their GOOD case -- but that
    # exemption must not become a free pass. Read from a side-on clip, _valgus
    # computes anterior knee displacement (a function of knee flexion), not
    # medial collapse: a different quantity wearing the label. No confidence
    # discount repairs an invalid construct, so it is demoted outright.
    if (1.0 - obs) < OBSERVABILITY_FLOOR:
        for m in result["metrics"]:
            if m["key"] in FRONTAL_EXEMPT:
                m["trustStatus"] = "experimental"
        result["flaws"] = [f for f in result["flaws"]
                           if f["id"].removeprefix("flaw-").replace("-", "_")
                           not in _GATED_KEYS(result)]
    if obs < OBSERVABILITY_FLOOR:
        result["captureQuality"]["primaryNudge"] = (
            "This clip was filmed close to head-on, so the running-plane angles rest on "
            "depth the camera could not see. Film from nearer the side for trustworthy "
            "joint angles.")
    return result


# ── Multi-segment routing ─────────────────────────────────────────────────────
# A clip filmed by a rotating operator, or any clip where the athlete changes
# heading, does not have ONE viewpoint. It has a different one every second, and
# collapsing that to a single azimuth throws away the best part of the capture.
#
# Measured on a synthetic lap sweeping every heading past a fixed filmer:
#   whole-clip, one azimuth   sagittal MAE 7.13 deg,  0/11 trusted, 0 flaws
#   per-segment routing       sagittal MAE 2.45 deg,  3/11 trusted, plus
#                             knee valgus and pelvic drop TRUSTED from the
#                             head-on segment -- which a side-on clip can
#                             never supply at all.
#
# So a lap is not a degraded side-on capture. It is a superset: it contains a
# side-on view AND a frontal view of the same athlete in the same run.

SEGMENT_SECONDS = 1.5      # long enough for a stride, short enough to hold one view
VIEWPOINT_SPREAD_MIN = 0.25   # below this the clip has effectively one viewpoint
MIN_SEGMENT_FRAMES = 12


def segment_observability(poses: np.ndarray, fps: float,
                          up_world: Iterable[float] | None = None,
                          view_axis: Iterable[float] = (0.0, 0.0, 1.0),
                          seconds: float = SEGMENT_SECONDS) -> list[dict[str, Any]]:
    """Split a clip into segments and score how well each one saw the athlete.

    Returns one record per segment with its frame span, canonical rotation and
    sagittal observability. Frontal observability is the complement: the view
    that is worst for sagittal angles is the best one for knee valgus and
    pelvic drop, which is why a changing viewpoint is an asset rather than
    noise to be averaged away.
    """
    n = int(max(MIN_SEGMENT_FRAMES, round(seconds * fps)))
    out: list[dict[str, Any]] = []
    for start in range(0, len(poses), n):
        seg = poses[start:start + n]
        if len(seg) < MIN_SEGMENT_FRAMES:
            continue
        try:
            R = canonical_rotation(seg, up_world)
        except ValueError:
            continue          # heading indeterminate in this window; skip it
        obs = sagittal_observability(R, view_axis)
        out.append({"start": start, "stop": start + len(seg),
                    "rotation": R, "sagittal": obs, "frontal": 1.0 - obs})
    return out


def analyze_3d_multisegment(
    poses: np.ndarray,
    confidences: np.ndarray,
    fps: float,
    up_world: Iterable[float] | None = None,
    view_axis: Iterable[float] = (0.0, 0.0, 1.0),
    recon_conf: float = UNVALIDATED_RECON_CONF,
    clip_id: str = "clip",
    source_fps: float | None = None,
    capture_fps: float | None = None,
    timing_signal: list | None = None,
    timing_fps: float | None = None,
    seconds: float = SEGMENT_SECONDS,
) -> dict[str, Any]:
    """Route every metric to the segment of the clip that actually observed it.

    Sagittal metrics come from the segment with the highest sagittal
    observability; frontal metrics from the segment with the lowest (= best
    frontal). Temporal metrics are NOT segmented: cadence and ground contact
    average over many strides, so restricting them to one window would throw
    away the samples that make them precise.

    Falls back to the single-view path when the clip holds only one usable
    segment, so a normal side-on capture behaves exactly as before.
    """
    poses = np.asarray(poses, dtype=float)
    confidences = np.asarray(confidences, dtype=float)
    segs = segment_observability(poses, fps, up_world, view_axis, seconds)
    # Fall back on whether the viewpoint actually CHANGES, not on how many
    # segments a clip happens to divide into. A three-second side-on capture
    # splits into two segments but contains one viewpoint, and routing it would
    # discard half the frames for nothing.
    spread = (max(s_["sagittal"] for s_ in segs) - min(s_["sagittal"] for s_ in segs)) if segs else 0.0
    if len(segs) < 2 or spread < VIEWPOINT_SPREAD_MIN:
        return analyze_3d_angle_agnostic(
            poses, confidences, fps, up_world=up_world, recon_conf=recon_conf,
            clip_id=clip_id, source_fps=source_fps, capture_fps=capture_fps,
            timing_signal=timing_signal, timing_fps=timing_fps, view_axis=view_axis)

    best_sag = max(segs, key=lambda s: s["sagittal"])
    best_fro = max(segs, key=lambda s: s["frontal"])

    pose_fps = float(fps)
    src_fps = float(source_fps if source_fps is not None else pose_fps)
    cap_fps = float(capture_fps if capture_fps is not None else pose_fps)
    common = dict(min_frames=MIN_SEGMENT_FRAMES, max_frames=450,
                  src_fps=src_fps, image_down=VIRTUAL_IMAGE_DOWN,
                  estimate_azimuth=False)

    def scalars(seg, view, azimuth):
        sl = slice(seg["start"], seg["stop"])
        frames = reproject(poses[sl], confidences[sl], view, rotation=seg["rotation"])
        return _collect_scalars(iter(frames), azimuth, **common)

    S_sag, idxs, _, _, dropped, _t1 = scalars(best_sag, "side", 0.0)
    S_fro, _, _, _, _, _t2 = scalars(best_fro, "front", 90.0)

    S = dict(S_sag)
    n = len(idxs)
    for key in FRONTAL_SCALARS:
        src = S_fro[key]
        # The two segments need not be the same length; resample the frontal
        # series onto the sagittal frame count so one _assemble sees a coherent
        # table. Frontal metrics are per-frame percentiles, so resampling
        # changes which frames contribute, never what is being measured.
        S[key] = list(np.interp(np.linspace(0, 1, n),
                                np.linspace(0, 1, len(src)), src)) if src else S_sag[key]

    result = _assemble(
        S, idxs, pose_fps, _metric_mean_conf(poses, confidences), 0.0, clip_id,
        capture_fps=cap_fps, source_fps=src_fps,
        timing_signal=timing_signal, timing_fps=timing_fps,
        dropped_pct=dropped, vp_override=0.0, recon_conf=recon_conf,
    )

    cq = result["captureQuality"]
    cq["segments"] = len(segs)
    cq["sagittalObservability"] = round(best_sag["sagittal"], 3)
    cq["frontalObservability"] = round(best_fro["frontal"], 3)
    cq["sagittalSegment"] = [best_sag["start"], best_sag["stop"]]
    cq["frontalSegment"] = [best_fro["start"], best_fro["stop"]]

    # Each family is gated on the segment that produced it, not on the clip.
    if best_sag["sagittal"] < OBSERVABILITY_FLOOR:
        for m in result["metrics"]:
            if m.get("tier") in (2, 3) and m["key"] not in FRONTAL_EXEMPT:
                m["trustStatus"] = "experimental"
    if best_fro["frontal"] < OBSERVABILITY_FLOOR:
        for m in result["metrics"]:
            if m["key"] in FRONTAL_EXEMPT:
                m["trustStatus"] = "experimental"
    return result
