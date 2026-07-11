"""Overlay timestamp + dual-fps trust smoke tests for biomech2d."""
from __future__ import annotations

import numpy as np

from src.biomech2d import (
    FPS_TRUST_GATE,
    analyze_2d_sagittal_stream,
    estimate_azimuth_from_keypoints,
    resolve_image_axes,
)


def _fake_frame(frame_index: int, az_ratio: float = 0.95) -> dict:
    """Minimal COCO-17 frame with usable confidences. az_ratio ~ hip/shoulder width."""
    kp = np.zeros((17, 3), dtype=float)
    kp[:, 2] = 0.9
    kp[5] = [0.30, 0.40, 0.9]
    kp[6] = [0.30, 0.60, 0.9]
    hw = 0.20 * az_ratio
    kp[11] = [0.50, 0.40 + (0.20 - hw) / 2, 0.9]
    kp[12] = [0.50, 0.40 + (0.20 - hw) / 2 + hw, 0.9]
    for i, x in ((13, 0.42), (14, 0.58), (15, 0.42), (16, 0.58)):
        kp[i] = [0.70 if i < 15 else 0.90, x, 0.9]
    kp[7] = [0.40, 0.35, 0.9]
    kp[9] = [0.50, 0.32, 0.9]
    kp[8] = [0.40, 0.65, 0.9]
    kp[10] = [0.50, 0.68, 0.9]
    return {"frame_index": frame_index, "keypoints": kp, "excluded": False}


def test_overlay_tMs_uses_source_fps_not_pose_fps():
    overlay = []
    frames = [_fake_frame(i) for i in (0, 8, 16, 24, 32, 40, 48, 56, 64, 72)]
    analyze_2d_sagittal_stream(
        frames, fps=15.0, azimuth_deg=20.0, clip_id="t",
        min_frames=8, overlay_out=overlay, source_fps=120.0, capture_fps=120.0,
        estimate_azimuth=False,
    )
    assert overlay[0]["tMs"] == 0.0
    assert abs(overlay[1]["tMs"] - (8 / 120 * 1000)) < 0.2
    assert overlay[1]["frameIndex"] == 8


def test_capture_quality_reports_capture_fps():
    frames = [_fake_frame(i * 8) for i in range(12)]
    result = analyze_2d_sagittal_stream(
        frames, fps=15.0, azimuth_deg=10.0, clip_id="t",
        min_frames=8, source_fps=120.0, capture_fps=120.0,
        estimate_azimuth=False,
    )
    assert result["captureQuality"]["fps"] == 120.0
    assert result["captureQuality"]["poseFps"] == 15.0
    cadence = next(m for m in result["metrics"] if m["key"] == "cadence_spm")
    assert cadence["trustStatus"] == "experimental"
    assert FPS_TRUST_GATE == 120.0


def test_gravity_axes_tilt():
    down, up = resolve_image_axes((0.0, 1.0))
    assert abs(float(down[1]) - 1.0) < 1e-6
    assert abs(float(up[1]) + 1.0) < 1e-6


def test_estimate_azimuth_side_on():
    k = _fake_frame(0, az_ratio=0.2)["keypoints"]
    az = estimate_azimuth_from_keypoints(k)
    assert az is not None
    assert 0 <= az <= 90
