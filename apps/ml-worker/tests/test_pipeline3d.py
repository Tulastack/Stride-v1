"""Tests for WHAM + OpenCap pipeline modules (CPU path)."""

from __future__ import annotations

from src.opencap_fit import opencap_monocular_fit
from src.wham_lift import smpl_gravity_lift, movenet_frames_to_engine


def _sample_capture() -> dict:
    return {
        "widthPx": 1080,
        "heightPx": 1920,
        "fps": 60,
        "gyro": [{"tMs": 0, "yawRateRadS": 0.01, "pitchRateRadS": 0, "rollRateRadS": 0}],
        "intrinsics": {"focalLengthPx": 1500, "principalPointPx": [540, 960], "sensorWidthPx": 1080, "sensorHeightPx": 1920},
    }


def _synthetic_movenet_frames(n: int = 12) -> list[dict]:
    frames = []
    for i in range(n):
        phase = 2 * 3.14159 * i / n
        y_base = 0.55
        frames.append(
            {
                "frame_index": i,
                "excluded": False,
                "avg_confidence": 0.85,
                "keypoint_dict": {
                    "nose": [y_base - 0.28, 0.5, 0.9],
                    "left_shoulder": [y_base - 0.18, 0.42, 0.88],
                    "right_shoulder": [y_base - 0.18, 0.58, 0.88],
                    "left_hip": [y_base, 0.43, 0.9],
                    "right_hip": [y_base, 0.57, 0.9],
                    "left_knee": [y_base + 0.12, 0.43, 0.85],
                    "right_knee": [y_base + 0.1, 0.57, 0.85],
                    "left_ankle": [y_base + 0.28, 0.43, 0.82],
                    "right_ankle": [y_base + 0.26, 0.57, 0.82],
                },
            }
        )
    return frames


def test_movenet_to_engine_produces_joints() -> None:
    kp, fps = movenet_frames_to_engine(_synthetic_movenet_frames(), 1080, 1920, 30)
    assert len(kp) == 12
    assert fps == 30
    assert "neck" in kp[0]["joints"]


def test_smpl_gravity_lift_and_opencap_fit() -> None:
    kp, _ = movenet_frames_to_engine(_synthetic_movenet_frames(), 1080, 1920, 30)
    stage2 = smpl_gravity_lift(kp, _sample_capture(), 30)
    assert len(stage2) == 12
    assert "l_hip" in stage2[0]["pose"]

    stage3, backend = opencap_monocular_fit(stage2)
    assert len(stage3) == 12
    assert backend.startswith("opencap")
    assert stage3[0]["reconResidual"] >= 0
