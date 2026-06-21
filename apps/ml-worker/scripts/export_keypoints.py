#!/usr/bin/env python3
"""Export MoveNet keypoints to JSON for the Node biomechanics engine (Stage 1).

Usage: python3 export_keypoints.py /path/to/video.mp4
Prints JSON to stdout: { fps, frames: [{ tMs, joints: { joint: {x,y,confidence} } }] }
"""
from __future__ import annotations

import json
import sys

# Map MoveNet COCO names -> engine joint names (normalized 0-1 coords)
MOVENET_TO_ENGINE = {
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


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: export_keypoints.py <video>", file=sys.stderr)
        sys.exit(1)
    video_path = sys.argv[1]
    try:
        from src.movenet import process_video
    except ImportError:
        print(json.dumps({"fps": 30, "frames": []}))
        return

    result = process_video(video_path)
    fps = result.get("fps", 30)
    width = result.get("width", 1080)
    height = result.get("height", 1920)
    out_frames = []

    for i, frame in enumerate(result.get("frames", [])):
        joints = {}
        kps = frame.get("keypoints", {})
        for mn, eng in MOVENET_TO_ENGINE.items():
            if mn not in kps:
                continue
            y, x, conf = kps[mn]
            joints[eng] = {
                "x": float(x) / width if width else x,
                "y": float(y) / height if height else y,
                "confidence": float(conf),
            }
        # neck midpoint
        if "l_shoulder" in joints and "r_shoulder" in joints:
            joints["neck"] = {
                "x": (joints["l_shoulder"]["x"] + joints["r_shoulder"]["x"]) / 2,
                "y": (joints["l_shoulder"]["y"] + joints["r_shoulder"]["y"]) / 2,
                "confidence": min(joints["l_shoulder"]["confidence"], joints["r_shoulder"]["confidence"]),
            }
        out_frames.append({"tMs": int(i * 1000 / fps), "joints": joints})

    print(json.dumps({"fps": fps, "frames": out_frames}))


if __name__ == "__main__":
    main()
