"""A kept 3D lift that cannot score must not be treated as a real grade."""
from src.worker import lift_left_a_score


def test_unusable_lift_is_not_a_score():
    result = {
        "economyScore": 0,
        "metrics": [
            {"key": "knee_drive", "measured": {"value": 29.2}},
            {"key": "cadence_spm", "measured": {"value": 389.3}},
        ],
        "captureQuality": {
            "perMetricUsable": {"knee_drive": False, "cadence_spm": False},
        },
    }
    assert lift_left_a_score(result) is False


def test_usable_lift_keeps_the_3d_score():
    result = {
        "economyScore": 63,
        "metrics": [{"key": "knee_drive", "measured": {"value": 92.0}}],
        "captureQuality": {"perMetricUsable": {"knee_drive": True}},
    }
    assert lift_left_a_score(result) is True
