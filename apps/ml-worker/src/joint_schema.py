"""Shared 3D joint schema — must match apps/api/src/analysis/engine/types.ts."""

from __future__ import annotations

from typing import TypedDict

JOINT_NAMES: list[str] = [
    "head",
    "neck",
    "l_shoulder",
    "r_shoulder",
    "l_hip",
    "r_hip",
    "l_knee",
    "r_knee",
    "l_ankle",
    "r_ankle",
    "l_toe",
    "r_toe",
]

# MoveNet COCO → engine joints (normalized image coords)
MOVENET_TO_ENGINE: dict[str, str] = {
    "nose": "head",
    "left_shoulder": "l_shoulder",
    "right_shoulder": "r_shoulder",
    "left_hip": "l_hip",
    "right_hip": "r_hip",
    "left_knee": "l_knee",
    "right_knee": "r_knee",
    "left_ankle": "l_ankle",
    "right_ankle": "r_ankle",
}

# SMPL-24 body joint names used by WHAM → engine subset
WHAM_JOINT_MAP: dict[str, str] = {
    "Head": "head",
    "Neck": "neck",
    "L_Shoulder": "l_shoulder",
    "R_Shoulder": "r_shoulder",
    "L_Hip": "l_hip",
    "R_Hip": "r_hip",
    "L_Knee": "l_knee",
    "R_Knee": "r_knee",
    "L_Ankle": "l_ankle",
    "R_Ankle": "r_ankle",
    "L_Foot": "l_toe",
    "R_Foot": "r_toe",
}

# Anthropometric bone lengths (metres) — OpenCap-style prior
BONE_LENGTH_M: dict[str, float] = {
    "neck": 0.18,
    "l_shoulder": 0.18,
    "r_shoulder": 0.18,
    "l_hip": 0.45,
    "r_hip": 0.45,
    "l_knee": 0.43,
    "r_knee": 0.43,
    "l_ankle": 0.08,
    "r_ankle": 0.08,
    "l_toe": 0.12,
    "r_toe": 0.12,
}


class Frame3D(TypedDict):
    timestampMs: int
    pose: dict[str, list[float]]
    keypointConfidence: float
    reconResidual: float


class Pipeline3DResult(TypedDict):
    frames: list[Frame3D]
    fps: float
    cameraAzimuthDeg: float
    reconstructionMethod: str
    meanKeypointConfidence: float
    meanReconResidual: float
    stage2Backend: str
    stage3Backend: str
