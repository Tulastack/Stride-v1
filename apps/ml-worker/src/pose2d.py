"""Pose2D provider seam.

Selects the 2D keypoint backend via POSE2D_BACKEND:
  • movenet  (default) — MoveNet SinglePose Thunder (edge model, no detector)
  • rtmpose            — RTMDet detector + RTMPose (open-source, top-down, ONNX)

Both return the identical per-frame contract, so Stages 2–7 are unchanged.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def process_video(video_path: str, target_fps: int = 30) -> list[dict[str, Any]]:
    backend = os.environ.get("POSE2D_BACKEND", "movenet").lower()
    if backend == "rtmpose":
        from src.rtmpose_backend import process_video as rtm
        logger.info("Pose2D backend: rtmpose")
        return rtm(video_path, target_fps=target_fps)
    from src.movenet import process_video as mv
    logger.info("Pose2D backend: movenet")
    return mv(video_path, target_fps=target_fps)


def stream_frames(video_path: str, target_fps: int = 30):
    """Memory-lean generator: yields one lean frame dict at a time. Backends that
    don't provide a streaming path fall back to iterating their list output."""
    backend = os.environ.get("POSE2D_BACKEND", "movenet").lower()
    if backend == "rtmpose":
        from src.rtmpose_backend import iter_frames
        logger.info("Pose2D backend (stream): rtmpose")
        yield from iter_frames(video_path, target_fps=target_fps)
        return
    from src.movenet import process_video as mv
    logger.info("Pose2D backend (stream): movenet")
    yield from mv(video_path, target_fps=target_fps)
