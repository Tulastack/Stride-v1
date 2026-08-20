"""Camera-azimuth estimation must RESPOND to the camera.

The previous estimator divided hip width by shoulder width. Both are
mediolateral spans, so both foreshorten by the same sin(azimuth) factor and it
cancels — it returned the athlete's bi-iliac/biacromial ratio, an anthropometric
constant, for every camera position. That pinned azimuth near 41° on every clip
and made the tier-2 trust gate unreachable, so no joint angle could ever raise a
flaw.

The old test only asserted `0 <= az <= 90`, which any constant satisfies. These
tests assert the property that actually matters: the estimate must track the
camera. `test_azimuth_is_not_camera_invariant` is the specific regression guard.
"""
from __future__ import annotations

import math

import numpy as np

from src.biomech2d import (
    HIP_TORSO_RATIO,
    SHOULDER_TORSO_RATIO,
    _viewpoint_penalty,
    estimate_azimuth_from_keypoints,
)
from src.canonical_2d import CANON_KP as KP

# Normalized image units for the synthetic athlete.
_TORSO = 0.29
_HIP_Y = 0.60
_CX = 0.50


def _frame_at(azimuth_deg: float, conf: float = 0.9) -> np.ndarray:
    """COCO-17 keypoints for an upright athlete viewed at `azimuth_deg`.

    0° = side-on, so mediolateral spans project to zero; 90° = head-on, where
    they project at full width. Torso length is superoinferior and constant.
    """
    s = math.sin(math.radians(azimuth_deg))
    sw = SHOULDER_TORSO_RATIO * _TORSO * s
    hw = HIP_TORSO_RATIO * _TORSO * s
    sh_y = _HIP_Y - _TORSO

    k = np.zeros((17, 3), dtype=float)
    k[:, 2] = conf
    # keypoints are [y, x, conf]
    k[KP["left_shoulder"]] = [sh_y, _CX - sw / 2, conf]
    k[KP["right_shoulder"]] = [sh_y, _CX + sw / 2, conf]
    k[KP["left_hip"]] = [_HIP_Y, _CX - hw / 2, conf]
    k[KP["right_hip"]] = [_HIP_Y, _CX + hw / 2, conf]
    return k


def test_azimuth_tracks_camera_angle():
    """The whole point: rotating the camera must move the estimate."""
    for truth in (0, 15, 30, 45, 60, 75, 90):
        est = estimate_azimuth_from_keypoints(_frame_at(truth))
        assert est is not None, f"no estimate at {truth}°"
        assert abs(est - truth) < 3.0, f"camera at {truth}° estimated as {est}°"


def test_azimuth_is_not_camera_invariant():
    """Regression guard for the cancelling-ratio bug.

    The old implementation returned a near-constant here (acos of the athlete's
    hip/shoulder ratio) regardless of the camera, so the spread was ~0.
    """
    ests = [estimate_azimuth_from_keypoints(_frame_at(a)) for a in (0, 45, 90)]
    assert all(e is not None for e in ests)
    assert max(ests) - min(ests) > 60.0, f"estimate barely moved across views: {ests}"


def test_azimuth_is_monotonic_in_camera_angle():
    ests = [estimate_azimuth_from_keypoints(_frame_at(a)) for a in range(0, 91, 10)]
    assert all(b >= a - 0.5 for a, b in zip(ests, ests[1:])), ests


def test_side_on_reads_near_zero_and_head_on_near_ninety():
    assert estimate_azimuth_from_keypoints(_frame_at(0)) < 5.0
    assert estimate_azimuth_from_keypoints(_frame_at(90)) > 85.0


def test_low_confidence_keypoints_yield_no_estimate():
    """Better to fall back to the caller's default than to guess from noise."""
    assert estimate_azimuth_from_keypoints(_frame_at(45, conf=0.1)) is None


def test_degenerate_torso_yields_no_estimate():
    k = _frame_at(45)
    k[KP["left_shoulder"]][0] = _HIP_Y
    k[KP["right_shoulder"]][0] = _HIP_Y  # shoulders collapse onto the hips
    assert estimate_azimuth_from_keypoints(k) is None


def test_sagittal_metrics_can_reach_the_trust_gate_from_a_side_view():
    """The bug's real consequence: with azimuth pinned at ~41°, tier-2
    confidence maxed out at mean_conf * 0.562, so `>= 0.6` needed mean_conf
    >= 1.07 — unreachable. A genuine side-on view must clear it."""
    az = estimate_azimuth_from_keypoints(_frame_at(0))
    vp = _viewpoint_penalty(az, "sagittal")
    mean_conf = 0.75  # a realistic good clip
    assert mean_conf * (1 - vp) >= 0.6


def test_frontal_metrics_stay_gated_from_a_side_view():
    """The inverse penalty must still exclude knee valgus / pelvic drop when
    the athlete was filmed from the side."""
    az = estimate_azimuth_from_keypoints(_frame_at(0))
    assert _viewpoint_penalty(az, "frontal") > 0.9
