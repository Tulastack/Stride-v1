"""Break `rtmpose_backend.iter_frames` into its parts and time each one.

pose_extraction is the biggest line in the analysis budget, but "pose
extraction" is four different things: decoding every frame, converting every
frame to grey for the timing signal, running optical flow between pose
keyframes, and running YOLOX+RTMPose on the sampled ones. Only one of those is
the model. This measures them separately so the fix targets the right one.

    python -m scripts.time_pose_loop --clip IMG_0271.MOV
"""
from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

import cv2
import numpy as np

os.environ.setdefault('POSE2D_BACKEND', 'rtmpose')
os.environ.setdefault('RTMPOSE_MODE', 'lightweight')

ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / 'test-videos'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--clip', required=True)
    ap.add_argument('--pose-fps', type=int, default=15)
    ap.add_argument('--timing', default='on', choices=['on', 'off'],
                    help='whether the dual-rate timing signal is collected (3d-geo passes it)')
    args = ap.parse_args()

    from src.rtmpose_backend import _load_body, _maybe_downscale, _LK_PARAMS
    from src.movenet import CORE_JOINTS, KEYPOINT_INDEX

    body = _load_body()
    path = str(VIDEO_DIR / args.clip)
    cap = cv2.VideoCapture(path)
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval = source_fps / min(args.pose_fps, source_fps)
    core_idx = [KEYPOINT_INDEX[j] for j in CORE_JOINTS]
    want_timing = args.timing == 'on'

    t = {'decode': 0.0, 'gray': 0.0, 'lk': 0.0, 'downscale': 0.0, 'inference': 0.0, 'select': 0.0}
    n = {'frames': 0, 'sampled': 0, 'lk': 0}

    prev_gray = None
    ankle_pts = None
    next_sample = 0.0
    frame_idx = 0
    la, ra = KEYPOINT_INDEX['left_ankle'], KEYPOINT_INDEX['right_ankle']
    wall0 = time.perf_counter()

    while True:
        t0 = time.perf_counter()
        ret, frame = cap.read()
        t['decode'] += time.perf_counter() - t0
        if not ret:
            break
        n['frames'] += 1
        h, w = frame.shape[:2]

        gray = None
        if want_timing:
            t0 = time.perf_counter()
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            t['gray'] += time.perf_counter() - t0

        if frame_idx >= next_sample:
            n['sampled'] += 1
            t0 = time.perf_counter()
            frame_inf, frame_scale = _maybe_downscale(frame)
            t['downscale'] += time.perf_counter() - t0

            t0 = time.perf_counter()
            kpts, scores = body(frame_inf)
            t['inference'] += time.perf_counter() - t0

            t0 = time.perf_counter()
            if len(scores) > 0:
                best = int(np.argmax([float(np.mean(s[core_idx])) for s in scores]))
                xy = kpts[best] / (frame_scale or 1.0)
                if want_timing:
                    ankle_pts = np.array(
                        [[float(xy[la, 0]), float(xy[la, 1])],
                         [float(xy[ra, 0]), float(xy[ra, 1])]], dtype=np.float32)
            t['select'] += time.perf_counter() - t0
            next_sample += interval
        elif want_timing and ankle_pts is not None and prev_gray is not None:
            t0 = time.perf_counter()
            new_pts, _st, _err = cv2.calcOpticalFlowPyrLK(
                prev_gray, gray, ankle_pts, None, **_LK_PARAMS)
            t['lk'] += time.perf_counter() - t0
            n['lk'] += 1
            if new_pts is not None:
                ankle_pts = new_pts

        if want_timing:
            prev_gray = gray
        frame_idx += 1

    cap.release()
    wall = time.perf_counter() - wall0
    dur = total / max(source_fps, 1e-6)

    print(f"\n{args.clip}  {w}x{h}  {source_fps:.1f}fps  {total} frames  {dur:.1f}s video"
          f"  timing_signal={args.timing}")
    print(f"{'stage':<12} {'seconds':>9} {'% of loop':>10}   detail")
    rows = [
        ('decode', t['decode'], f"{n['frames']} frames"),
        ('gray', t['gray'], f"{n['frames']} full-res BGR2GRAY" if want_timing else 'skipped'),
        ('lk flow', t['lk'], f"{n['lk']} full-res optical-flow steps"),
        ('downscale', t['downscale'], f"{n['sampled']} sampled"),
        ('inference', t['inference'], f"{n['sampled']} YOLOX+RTMPose calls"),
        ('select', t['select'], ''),
    ]
    for name, secs, detail in rows:
        print(f'{name:<12} {secs:9.2f} {100 * secs / max(wall, 1e-9):9.1f}%   {detail}')
    print(f"{'TOTAL':<12} {wall:9.2f} {100.0:9.1f}%   {wall / max(dur, 1e-6):.2f}x realtime")


if __name__ == '__main__':
    main()
