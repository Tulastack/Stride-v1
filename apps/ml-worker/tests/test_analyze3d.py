"""Two-pass virtual-camera analysis.

The single-view path can only ever measure frontal quantities from whatever
angle the athlete happened to be filmed at, and discount confidence when that
angle is wrong. These tests assert the thing the two-pass design buys: frontal
metrics measured from a camera actually facing the athlete, sagittal metrics
from one beside them, and the whole clip still scored as one athlete.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from src.analyze3d import (
    FRONTAL_SCALARS,
    UNVALIDATED_RECON_CONF,
    analyze_3d_angle_agnostic,
)
from src.biomech2d import TRUST_CONF_MIN
from src.canonical_2d import CANON_KP as KP

from test_virtual_camera import CAMERA_ANGLES, FPS, _clip, _rot_yaw


def _run(poses, conf, **kw):
    return analyze_3d_angle_agnostic(poses, conf, fps=FPS, source_fps=FPS,
                                     capture_fps=FPS, clip_id="a3d", **kw)


def test_produces_a_complete_result():
    poses, conf = _clip()
    r = _run(poses, conf)
    for field in ("metrics", "flaws", "focusAreas", "recommendations",
                  "captureQuality", "economyScore", "phase", "summary"):
        assert field in r, f"missing {field}"
    assert len(r["metrics"]) == 11


def test_result_is_invariant_to_camera_position():
    """The whole purpose, asserted on the full assembled result rather than on
    raw metric values: score, phase and every metric must agree."""
    poses, conf = _clip()
    base = _run(poses, conf)
    base_m = {m["key"]: m["measured"]["value"] for m in base["metrics"]}

    for deg in CAMERA_ANGLES:
        got = _run(poses @ _rot_yaw(deg).T, conf)
        assert got["economyScore"] == base["economyScore"], f"score moved at {deg}deg"
        assert got["phase"] == base["phase"], f"phase moved at {deg}deg"
        for m in got["metrics"]:
            assert abs(m["measured"]["value"] - base_m[m["key"]]) < 0.5, \
                f"{m['key']} moved at camera {deg}deg"


def test_frontal_metrics_come_from_the_front_camera():
    """`_valgus` measures horizontal knee deviation. In a SAGITTAL image the
    horizontal axis is anteroposterior, so a side view returns anterior knee
    displacement — a function of knee flexion, not medial collapse. The two-pass
    result must therefore differ from a side-only read of the same skeleton."""
    from src.biomech2d import _assemble, _collect_scalars
    from src.virtual_camera import canonical_rotation, reproject
    from src.analyze3d import VIRTUAL_IMAGE_DOWN

    poses, conf = _clip()
    R = canonical_rotation(poses)
    side = reproject(poses, conf, "side", rotation=R)
    S, idxs, mc, _, dp = _collect_scalars(iter(side), 0.0, image_down=VIRTUAL_IMAGE_DOWN,
                                          estimate_azimuth=False, src_fps=FPS)
    side_only = _assemble(S, idxs, FPS, mc, 0.0, "side", capture_fps=FPS,
                          source_fps=FPS, dropped_pct=dp, vp_override=0.0)
    side_v = {m["key"]: m["measured"]["value"] for m in side_only["metrics"]}
    both_v = {m["key"]: m["measured"]["value"] for m in _run(poses, conf)["metrics"]}

    assert side_v["knee_valgus"] != both_v["knee_valgus"], \
        "frontal metric identical from both views — the front pass did nothing"
    # Sagittal metrics must be untouched by the merge.
    for key in ("trunk_lean", "knee_drive", "hip_extension", "overstride"):
        assert side_v[key] == both_v[key], f"{key} changed when merging frontal scalars"


def test_only_frontal_scalars_are_swapped():
    assert set(FRONTAL_SCALARS) == {"knee_valgus", "pelvic_drop"}


# ── honesty ───────────────────────────────────────────────────────────────────

def test_nothing_is_trusted_without_a_validation_study():
    """An ideal viewpoint must not launder an unvalidated reconstruction into a
    trusted badge. This is the guard against repeating the reconResidual defect,
    where a constant-by-construction number fed a 0.91 confidence multiplier."""
    assert UNVALIDATED_RECON_CONF < TRUST_CONF_MIN
    poses, conf = _clip()
    conf[:] = 1.0  # a perfect detector, the most favourable case possible
    r = _run(poses, conf)
    assert all(m["trustStatus"] == "experimental" for m in r["metrics"]), \
        [m["key"] for m in r["metrics"] if m["trustStatus"] == "trusted"]


def test_no_flaws_are_raised_while_unvalidated():
    """Flaws require a trusted metric, so an unvalidated reconstruction must
    produce none — the honest output is hedged focus areas."""
    poses, conf = _clip()
    conf[:] = 1.0
    assert _run(poses, conf)["flaws"] == []


def test_raising_recon_confidence_can_reach_trust():
    """The gate must be reachable once a study justifies it, or the parameter is
    decorative rather than a real seam."""
    poses, conf = _clip()
    conf[:] = 0.95
    r = _run(poses, conf, recon_conf=0.95)
    assert any(m["trustStatus"] == "trusted" for m in r["metrics"])


def test_viewpoint_penalty_is_zero_on_every_metric():
    """Zero because we chose the camera, not because we ignored the problem."""
    poses, conf = _clip()
    r = _run(poses, conf)
    for fa in r.get("focusAreas", []):
        assert fa["evidence"]["viewpointPenalty"] == 0.0, fa["key"]


def test_no_refilm_nudge_since_angle_no_longer_matters():
    """The 'film from the side' nudge is meaningless once any angle works."""
    poses, conf = _clip()
    nudge = _run(poses, conf)["captureQuality"].get("primaryNudge") or ""
    assert "from the side" not in nudge


# ── plumbing ──────────────────────────────────────────────────────────────────

def test_timing_signal_is_measured_on_the_original_clip():
    """Cadence and contact time must not be re-derived from a re-projection;
    a synthetic camera cannot add temporal resolution."""
    poses, conf = _clip()
    n = int(FPS * (len(poses) / FPS))
    signal = [[i, 0.2 * math.sin(2 * math.pi * i / 12), 0.2 * math.cos(2 * math.pi * i / 12)]
              for i in range(n)]
    plain = _run(poses, conf)
    timed = _run(poses, conf, timing_signal=signal, timing_fps=240.0)
    pv = {m["key"]: m["measured"]["value"] for m in plain["metrics"]}
    tv = {m["key"]: m["measured"]["value"] for m in timed["metrics"]}
    assert tv["cadence_spm"] != pv["cadence_spm"] or tv["contact_time_ms"] != pv["contact_time_ms"]


def test_degenerate_clip_fails_loudly():
    poses, conf = _clip()
    poses[:] = np.nan
    with pytest.raises(ValueError):
        _run(poses, conf)


def test_frame_indices_reach_evidence_timestamps():
    poses, conf = _clip()
    r = _run(poses, conf, frame_indices=[i * 4 for i in range(len(poses))])
    stamped = [f["evidence"]["frameTimestampMs"] for f in r.get("focusAreas", [])]
    assert stamped, "no evidence produced to check"
    assert any(s > 0 for s in stamped)
