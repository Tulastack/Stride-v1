import math

import numpy as np

from src.biomech2d import (
    TRUST_TOLERANCE,
    _alternation_cadence,
    _plane_incline,
    _projection_error,
    _running_window,
)

FPS = 15.0


def _fits(key, value, azimuth, plane="sagittal"):
    return _projection_error(key, value, _plane_incline(azimuth, plane)) <= TRUST_TOLERANCE[key]


def test_the_error_budget_decides_not_a_fixed_azimuth_window():
    # side-on and moderately oblique views both certify a sagittal angle ...
    assert _fits("trunk_lean", 25, 0) and _fits("trunk_lean", 25, 30)
    assert _fits("hip_extension", 170, 50)
    # ... a steeply oblique one cannot, for the angles it actually distorts
    assert not _fits("trunk_lean", 25, 50)
    assert not _fits("knee_flexion", 70, 55)


def test_frontal_metrics_follow_the_inverse_geometry():
    assert not _fits("pelvic_drop", 6, 5, "frontal")
    assert _fits("pelvic_drop", 6, 85, "frontal")
    assert not _fits("knee_valgus", 4, 10, "frontal")
    assert _fits("knee_valgus", 4, 85, "frontal")


def test_a_virtual_on_axis_camera_has_no_projection_error():
    assert _plane_incline(70, "sagittal", vp_override=0.0) == 0.0
    assert _projection_error("knee_flexion", 60, 0.0) < 1e-6


def _strides(n_static, n_run, step_hz=4.0, shrink=1.0):
    """Static set position followed by striding; torso shrinks by `shrink`
    over the run, as when an athlete moves away from the camera."""
    t = np.arange(n_static + n_run) / FPS
    torso = np.concatenate([np.full(n_static, 0.1), np.linspace(0.1, 0.1 * shrink, n_run)])
    phase = np.where(np.arange(len(t)) < n_static, 0.0, np.sin(math.pi * step_hz * (t - n_static / FPS)))
    return {
        "torso_len": torso,
        "l_rel": 0.9 * torso + 0.02 * phase * torso / 0.1,
        "r_rel": 0.9 * torso - 0.02 * phase * torso / 0.1,
        "l_ax": 0.05 * phase * torso / 0.1,
        "r_ax": -0.05 * phase * torso / 0.1,
    }


def test_running_window_skips_a_set_position():
    a = _strides(40, 35)
    w0, w1 = _running_window(a, FPS)
    assert 36 <= w0 <= 42 and w1 >= 70


def test_running_window_survives_a_runner_shrinking_into_the_distance():
    a = _strides(0, 45, shrink=0.35)
    w0, w1 = _running_window(a, FPS)
    assert w0 <= 3 and w1 >= 42


def test_no_window_when_nobody_strides():
    assert _running_window(_strides(60, 0), FPS) is None


def test_alternation_cadence_counts_steps():
    a = _strides(0, 60, step_hz=4.0)
    assert abs(_alternation_cadence(a, FPS) - 240.0) <= 0.15 * 240.0
