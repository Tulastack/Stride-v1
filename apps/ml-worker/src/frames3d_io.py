"""Serialize / deserialize Frame3D clips for Node engine consumption."""

from __future__ import annotations

import json
from typing import Any

from src.joint_schema import Frame3D, Pipeline3DResult


def frames_to_json(result: Pipeline3DResult) -> str:
    return json.dumps(result, indent=2)


def frames_from_json(raw: str | dict[str, Any]) -> Pipeline3DResult:
    data = json.loads(raw) if isinstance(raw, str) else raw
    return {
        "frames": data.get("frames", []),
        "fps": float(data.get("fps", 60)),
        "cameraAzimuthDeg": float(data.get("cameraAzimuthDeg", 30)),
        "reconstructionMethod": data.get("reconstructionMethod", "3d-multi"),
        "meanKeypointConfidence": float(data.get("meanKeypointConfidence", 0.7)),
        "meanReconResidual": float(data.get("meanReconResidual", 0.1)),
        "stage2Backend": data.get("stage2Backend", "unknown"),
        "stage3Backend": data.get("stage3Backend", "unknown"),
    }


def write_frames_sidecar(path: str, result: Pipeline3DResult) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(frames_to_json(result))
