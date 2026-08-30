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


def test_metric_values_are_invariant_to_camera_position():
    """The core geometric guarantee: the canonical frame makes the measured
    VALUES independent of where the camera stood. Confidence is deliberately
    NOT part of this claim -- see the observability tests below."""
    poses, conf = _clip()
    base = _run(poses, conf)
    base_m = {m["key"]: m["measured"]["value"] for m in base["metrics"]}

    for deg in CAMERA_ANGLES:
        got = _run(poses @ _rot_yaw(deg).T, conf, view_axis=None)
        assert got["phase"] == base["phase"], f"phase moved at {deg}deg"
        for m in got["metrics"]:
            assert abs(m["measured"]["value"] - base_m[m["key"]]) < 0.5, \
                f"{m['key']} moved at camera {deg}deg"


def test_values_stay_invariant_even_when_trust_is_gated():
    """Values and confidence must move independently: a head-on view is less
    informative, but the number it does produce is the same number."""
    poses, conf = _clip()
    base = {m["key"]: m["measured"]["value"] for m in _run(poses, conf)["metrics"]}
    head_on = _run(poses, conf, view_axis=(1.0, 0.0, 0.0))
    for m in head_on["metrics"]:
        assert abs(m["measured"]["value"] - base[m["key"]]) < 0.5, m["key"]


def test_observability_is_reported_and_gates_trust():
    """A view that did not contain the sagittal plane may not certify sagittal
    metrics, however cleanly the reconstruction closed."""
    poses, conf = _clip()
    conf[:] = 0.95
    side = _run(poses, conf, recon_conf=0.95, view_axis=(0.0, 0.0, 1.0))
    head = _run(poses, conf, recon_conf=0.95, view_axis=(1.0, 0.0, 0.0))
    assert side["captureQuality"]["sagittalObservability"] > 0.9
    assert head["captureQuality"]["sagittalObservability"] < 0.2
    sag = lambda r: [m for m in r["metrics"]
                     if m.get("tier") in (2, 3) and m["key"] not in ("knee_valgus", "pelvic_drop")]
    assert any(m["trustStatus"] == "trusted" for m in sag(side))
    assert all(m["trustStatus"] == "experimental" for m in sag(head))


def test_head_on_capture_is_told_to_refilm():
    poses, conf = _clip()
    head = _run(poses, conf, view_axis=(1.0, 0.0, 0.0))
    assert "head-on" in (head["captureQuality"].get("primaryNudge") or "")


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
    S, idxs, mc, _, dp, _tr = _collect_scalars(iter(side), 0.0, image_down=VIRTUAL_IMAGE_DOWN,
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


# ── multi-segment routing ─────────────────────────────────────────────────────

def _lap(headings):
    """One clip in which the athlete passes through several headings, as when a
    stationary operator rotates to follow a runner around a track."""
    poses, conf = _clip()
    mixed = np.concatenate([poses @ _rot_yaw(a).T for a in headings])
    return mixed, np.tile(conf, (len(headings), 1))


def test_a_lap_carries_both_a_side_on_and_a_frontal_view():
    """The premise of segment routing: a changing heading is a superset of a
    fixed one, because it contains views a fixed camera never gets."""
    from src.analyze3d import segment_observability
    poses, _ = _lap(range(0, 360, 30))
    segs = segment_observability(poses, FPS, up_world=(0.0, 1.0, 0.0))
    assert len(segs) >= 6
    assert max(s["sagittal"] for s in segs) > 0.9, "no side-on segment found"
    assert max(s["frontal"] for s in segs) > 0.9, "no frontal segment found"


def test_routing_beats_collapsing_the_lap_to_one_azimuth():
    """Averaging every viewpoint into a single azimuth discards the capture's
    best moments. Routing each metric to the segment that saw it must not be
    worse, and on a lap it is markedly better."""
    from src.analyze3d import analyze_3d_multisegment
    poses, conf = _lap(range(0, 360, 30))
    kw = dict(fps=FPS, up_world=(0.0, 1.0, 0.0), source_fps=FPS,
              capture_fps=FPS, recon_conf=0.95)
    whole = analyze_3d_angle_agnostic(poses, conf, clip_id="w", **kw)
    routed = analyze_3d_multisegment(poses, conf, clip_id="m", **kw)
    n = lambda r: sum(1 for m in r["metrics"] if m["trustStatus"] == "trusted")
    assert n(routed) > n(whole), (n(routed), n(whole))


def test_frontal_metrics_are_certifiable_only_when_a_frontal_view_exists():
    """knee_valgus from a side-on clip measures anterior knee displacement, not
    medial collapse. It may be certified from a lap, which contains a real
    frontal view, and never from a side-on-only capture."""
    from src.analyze3d import analyze_3d_multisegment
    kw = dict(fps=FPS, up_world=(0.0, 1.0, 0.0), source_fps=FPS,
              capture_fps=FPS, recon_conf=0.95)
    lap_p, lap_c = _lap(range(0, 360, 30))
    side_p, side_c = _lap([0, 0, 0, 0])
    lap = analyze_3d_multisegment(lap_p, lap_c, clip_id="lap", **kw)
    side = analyze_3d_multisegment(side_p, side_c, clip_id="side", **kw)
    trust = lambda r, k: next(m["trustStatus"] for m in r["metrics"] if m["key"] == k)
    assert trust(lap, "knee_valgus") == "trusted"
    assert trust(side, "knee_valgus") == "experimental"


def test_single_view_clip_is_unchanged_by_routing():
    """A normal side-on capture has one usable viewpoint, so routing must fall
    back to the single-view path rather than inventing segments."""
    from src.analyze3d import analyze_3d_multisegment
    poses, conf = _clip()
    kw = dict(fps=FPS, up_world=(0.0, 1.0, 0.0), source_fps=FPS,
              capture_fps=FPS, recon_conf=0.95)
    a = analyze_3d_angle_agnostic(poses, conf, clip_id="a", **kw)
    b = analyze_3d_multisegment(poses, conf, clip_id="a", **kw)
    va = {m["key"]: m["measured"]["value"] for m in a["metrics"]}
    vb = {m["key"]: m["measured"]["value"] for m in b["metrics"]}
    assert va == vb


def test_temporal_metrics_are_not_restricted_to_one_segment():
    """Cadence averages over many strides; confining it to a 1.5 s window would
    throw away the samples that make it precise."""
    from src.analyze3d import analyze_3d_multisegment
    poses, conf = _lap(range(0, 360, 30))
    r = analyze_3d_multisegment(poses, conf, fps=FPS, up_world=(0.0, 1.0, 0.0),
                                source_fps=FPS, capture_fps=FPS, recon_conf=0.95,
                                clip_id="t")
    cad = next(m for m in r["metrics"] if m["key"] == "cadence_spm")
    assert cad["measured"]["value"] > 0
