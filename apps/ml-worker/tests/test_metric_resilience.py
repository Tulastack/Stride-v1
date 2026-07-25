"""Graceful degradation contract: a failed precondition downgrades a metric,
it never silently erases it — and it never kills the whole analysis.

Locks the three fatal paths reported from real use: (1) a flat/broken optical-
flow timing signal zeroed cadence/contact instead of falling back to the pose
series; (2) a peak statistic pushed outside the plausibility envelope by a few
corrupted frames dropped the metric entirely; (3) a high excluded-frame
fraction hard-failed clips that still had plenty of analyzable frames.
"""
import math

import numpy as np

from src.biomech2d import _assemble, analyze_2d_sagittal_stream
from src.canonical_2d import CANON_KP


def _series(n: int = 90):
    """Plausible in-band scalar series for a side-on runner."""
    t = np.arange(n)
    return {
        "knee_drive": list(95 + 8 * np.sin(t / 3)),
        "hip_ext":    list(172 + 6 * np.sin(t / 3 + 1)),
        "knee_flex":  list(40 + 10 * np.sin(t / 3 + 2)),
        "elbow":      list(88 + 5 * np.sin(t / 4)),
        "trunk":      list(15 + 1.5 * np.sin(t / 5)),
        "hip_y":      list(0.5 + 0.02 * np.sin(t / 2)),
        "torso_len":  [0.25] * n,
        "ank_x_rel":  list(0.05 * np.sin(t / 2)),
        "ank_y_rel":  list(0.3 + 0.1 * np.sin(t / 2)),
        "leg_len":    [0.4] * n,
        "conf":       [0.85] * n,
        "knee_valgus": list(3 + 1 * np.abs(np.sin(t / 3))),
        "pelvic_drop": list(4 + 2 * np.abs(np.sin(t / 3))),
        "l_rel":      list(0.30 + 0.14 * np.sin(t / 2)),
        "r_rel":      list(0.30 + 0.14 * np.sin(t / 2 + math.pi)),
    }


def _run(S, n=90, **kw):
    return _assemble(S, list(range(n)), 15.0, 0.85, 10.0, "test",
                     capture_fps=kw.pop("capture_fps", 30.0), source_fps=30.0, **kw)


def _metric(res, key):
    return next(m for m in res["metrics"] if m["key"] == key)


def test_flat_timing_signal_falls_back_to_pose_gait():
    # A broken/flat optical-flow signal yields no strikes — cadence and contact
    # must downgrade to the pose-rate estimate, not report 0 and vanish.
    flat = [(i, 0.5, 0.5) for i in range(300)]
    res = _run(_series(), timing_signal=flat, timing_fps=240.0, capture_fps=240.0)
    assert _metric(res, "cadence_spm")["measured"]["value"] > 0
    assert _metric(res, "contact_time_ms")["measured"]["value"] > 0
    # ... and the trust gate must see the HONEST (pose) sample rate, not the
    # 240 Hz of the signal that produced nothing.
    assert _metric(res, "cadence_spm")["trustStatus"] == "experimental"


def test_outlier_spikes_salvage_the_metric_instead_of_dropping_it():
    # A 4-frame keypoint corruption shoots the p95 knee-drive peak past the
    # physical envelope (135°). The robust fallback statistic recovers a sane
    # reading: reported, usable, demoted to experimental — not erased.
    S = _series()
    kd = np.asarray(S["knee_drive"], dtype=float)
    kd[40:46] = 300.0
    S["knee_drive"] = list(kd)
    res = _run(S)
    m = _metric(res, "knee_drive")
    assert m["measured"]["value"] <= 135.0
    assert m["trustStatus"] == "experimental"
    assert res["captureQuality"]["perMetricUsable"]["knee_drive"] is True


def _frame(i: int, excluded: bool):
    kp = np.zeros((17, 3), dtype=float)
    if not excluded:
        swing = 0.05 * math.sin(i / 2)
        pts = {
            "nose": (0.22, 0.50), "left_eye": (0.21, 0.49), "right_eye": (0.21, 0.51),
            "left_ear": (0.22, 0.48), "right_ear": (0.22, 0.52),
            "left_shoulder": (0.30, 0.48), "right_shoulder": (0.30, 0.52),
            "left_elbow": (0.38, 0.46), "right_elbow": (0.38, 0.54),
            "left_wrist": (0.45, 0.45), "right_wrist": (0.45, 0.55),
            "left_hip": (0.50, 0.485), "right_hip": (0.50, 0.515),
            "left_knee": (0.65, 0.50 + swing / 2), "right_knee": (0.65, 0.50 - swing / 2),
            "left_ankle": (0.80 + swing, 0.50 + swing), "right_ankle": (0.80 - swing, 0.50 - swing),
        }
        for name, (y, x) in pts.items():
            kp[CANON_KP[name]] = (y, x, 0.9)
    return {"frame_index": i, "keypoints": kp, "excluded": excluded}


def test_high_excluded_fraction_is_reported_not_fatal():
    # 70% of frames lost to tracking, but 12 good ones remain: the clip must
    # ANALYZE (dropped fraction surfaced in captureQuality + nudge), not die
    # with low_confidence_video.
    frames = [_frame(i, excluded=(i % 10 < 7)) for i in range(40)]
    res = analyze_2d_sagittal_stream(iter(frames), fps=15.0, azimuth_deg=10.0)
    cq = res["captureQuality"]
    assert cq["droppedFramePct"] == 0.7
    assert res["metrics"]
    assert "track" in cq.get("primaryNudge", "").lower() or "frame" in cq.get("primaryNudge", "").lower()


def test_truly_empty_clips_still_fail():
    frames = [_frame(i, excluded=(i >= 5)) for i in range(40)]  # only 5 usable
    try:
        analyze_2d_sagittal_stream(iter(frames), fps=15.0, azimuth_deg=10.0)
        assert False, "expected low_confidence_video"
    except ValueError as e:
        assert "low_confidence_video" in str(e)
