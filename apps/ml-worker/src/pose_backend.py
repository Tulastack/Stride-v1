"""PoseBackend registry — resolve a 2D pose backend by name (no more if/elif).

Adding a backbone = register its module here (name → import path). Each backend
module is expected to expose:

    KEYPOINT_FORMAT: str                      # native layout (see canonical_2d)
    iter_frames(video_path, target_fps, target) -> Iterator[frame dict]   (optional, streaming)
    process_video(video_path, target_fps)   -> list[frame dict]           (required)

The per-frame dict contract is unchanged: {frame_index, keypoints (K,3 [y,x,conf]
normalized), avg_confidence, excluded}. `pose2d` canonicalizes the keypoints via
the declared KEYPOINT_FORMAT before anything downstream sees them.
"""

from __future__ import annotations

import importlib

# name → import path. This is the ONE place a new backbone is wired in.
REGISTRY: dict[str, str] = {
    "rtmpose": "src.rtmpose_backend",
    "movenet": "src.movenet",
}

DEFAULT_BACKEND = "movenet"


def resolve(name: str | None):
    """Import and return the backend module for `name` (loud on unknown)."""
    key = (name or DEFAULT_BACKEND).lower()
    if key not in REGISTRY:
        raise ValueError(
            f"unknown POSE2D_BACKEND {name!r} — registered backends: {sorted(REGISTRY)}"
        )
    return importlib.import_module(REGISTRY[key])


def keypoint_format(module) -> str:
    """Native keypoint layout declared by a backend module (default coco17)."""
    return getattr(module, "KEYPOINT_FORMAT", "coco17")
