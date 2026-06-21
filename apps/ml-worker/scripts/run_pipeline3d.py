#!/usr/bin/env python3
"""CLI: run WHAM + OpenCap pipeline and print Pipeline3DResult JSON to stdout.

Usage: python3 run_pipeline3d.py /path/to/video.mp4 [/path/to/capture.json]
"""
from __future__ import annotations

import json
import sys

from src.capture_loader import load_capture_manifest_local
from src.frames3d_io import frames_to_json
from src.movenet import process_video
from src.pipeline3d import run_pipeline_3d


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: run_pipeline3d.py <video> [capture.json]", file=sys.stderr)
        sys.exit(1)
    video = sys.argv[1]
    capture = load_capture_manifest_local(video)
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            capture.update(json.load(f))
    movenet = process_video(video, target_fps=30)
    included = [f for f in movenet if not f["excluded"]]
    result = run_pipeline_3d(video, included, capture)
    print(frames_to_json(result))


if __name__ == "__main__":
    main()
