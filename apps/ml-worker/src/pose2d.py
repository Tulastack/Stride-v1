"""Pose2D provider seam.

Resolves the 2D keypoint backend by name via a registry (see pose_backend.py),
runs it, and CANONICALIZES every frame's keypoints onto the canonical COCO-17
layout (see canonical_2d.py) before anything downstream sees them. So:
  • adding a backbone = registering a module (no if/elif here);
  • biomech + the tracker always receive canonical joints in a known order,
    regardless of the backbone's native topology (fixes bug B2).

Backend selection: env POSE2D_BACKEND (default movenet). Both current backends
(movenet, rtmpose) natively emit COCO-17, so canonicalization is an identity for
them and Stages 2–7 are unchanged.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from src.canonical_2d import to_canonical
from src.pose_backend import keypoint_format, resolve

logger = logging.getLogger(__name__)

# Canonical layout that downstream consumers (biomech2d) rely on.
CANONICAL_FORMAT = "coco17"


def _canonicalize(frame: dict[str, Any], native_format: str) -> dict[str, Any]:
    """Map a backend frame's keypoints onto the canonical layout, in place."""
    frame["keypoints"] = to_canonical(frame["keypoints"], native_format)
    frame["keypoint_format"] = CANONICAL_FORMAT
    frame["source_format"] = native_format
    return frame


def process_video(video_path: str, target_fps: int = 30) -> list[dict[str, Any]]:
    name = os.environ.get("POSE2D_BACKEND", "movenet")
    mod = resolve(name)
    fmt = keypoint_format(mod)
    logger.info("Pose2D backend: %s (native=%s → canonical=%s)", name, fmt, CANONICAL_FORMAT)
    return [_canonicalize(f, fmt) for f in mod.process_video(video_path, target_fps=target_fps)]


def stream_frames(video_path: str, target_fps: int = 30, target=None, timing_out=None):
    """Memory-lean generator: yields one canonical frame dict at a time. `target`
    is the user-selected athlete (normalized point or brush bbox) to crop-track;
    backends without a streaming/tracking path fall back to their list output.
    `timing_out` (optional list) is filled by streaming backends with a full-fps
    ankle signal for dual-rate cadence/contact-time (see rtmpose_backend)."""
    name = os.environ.get("POSE2D_BACKEND", "movenet")
    mod = resolve(name)
    fmt = keypoint_format(mod)
    if hasattr(mod, "iter_frames"):
        logger.info("Pose2D backend (stream): %s%s (native=%s)", name, " +target" if target else "", fmt)
        it = mod.iter_frames(video_path, target_fps=target_fps, target=target, timing_out=timing_out)
    else:
        logger.info("Pose2D backend (stream→list): %s (native=%s)", name, fmt)
        it = mod.process_video(video_path, target_fps=target_fps)
    for f in it:
        yield _canonicalize(f, fmt)
