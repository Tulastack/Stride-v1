"""Stages 2–3 orchestrator: WHAM lift → OpenCap-Monocular skeleton fit."""

from __future__ import annotations

import logging
from typing import Any

import cv2

from src.joint_schema import Pipeline3DResult
from src.opencap_fit import opencap_monocular_fit
from src.wham_lift import wham_lift

logger = logging.getLogger(__name__)


def _estimate_azimuth(movenet_frames: list[dict[str, Any]], capture: dict[str, Any]) -> float:
    if capture.get("cameraAzimuthDeg") is not None:
        return float(capture["cameraAzimuthDeg"])
    ratios: list[float] = []
    for fr in movenet_frames:
        if fr.get("excluded"):
            continue
        kd = fr.get("keypoint_dict") or {}
        ls, rs = kd.get("left_shoulder"), kd.get("right_shoulder")
        lh, rh = kd.get("left_hip"), kd.get("right_hip")
        if not all((ls, rs, lh, rh)):
            continue
        sw = abs(rs[1] - ls[1])
        if sw < 1e-4:
            continue
        hw = abs(rh[1] - lh[1])
        ratios.append(min(1.0, hw / sw))
    if not ratios:
        return 30.0
    import math

    r = sum(ratios) / len(ratios)
    return round(math.degrees(math.acos(max(0, min(1, r)))), 1)


def run_pipeline_3d(
    video_path: str,
    movenet_frames: list[dict[str, Any]],
    capture: dict[str, Any],
) -> Pipeline3DResult:
    cap = cv2.VideoCapture(video_path)
    source_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30)
    cap.release()

    stage2_frames, stage2_backend = wham_lift(video_path, movenet_frames, capture, source_fps)
    stage3_frames, stage3_backend = opencap_monocular_fit(stage2_frames)

    confs = [f["keypointConfidence"] for f in stage3_frames]
    residuals = [f["reconResidual"] for f in stage3_frames]
    mean_conf = sum(confs) / len(confs) if confs else 0.5
    mean_res = sum(residuals) / len(residuals) if residuals else 0.15

    reconstruction = "3d-multi" if stage2_backend == "wham-gpu" else "3d-mono"

    return {
        "frames": stage3_frames,
        "fps": min(120.0, max(10.0, capture.get("fps") or source_fps)),
        "cameraAzimuthDeg": _estimate_azimuth(movenet_frames, capture),
        "reconstructionMethod": reconstruction,
        "meanKeypointConfidence": round(mean_conf, 4),
        "meanReconResidual": round(mean_res, 4),
        "stage2Backend": stage2_backend,
        "stage3Backend": stage3_backend,
    }
