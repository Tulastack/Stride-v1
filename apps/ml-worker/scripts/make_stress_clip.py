"""Build a long, high-resolution clip out of a real one, for latency testing.

The in-app camera records 1080p for at most 12 s, but the Analyze screen also
lets the athlete pick any video out of their library, and a phone library is
full of 4K clips minutes long. Those are the inputs that produced the 300 s and
1800 s analyses in the database, and there is no clip like that in test-videos/,
so this makes one from a clip we do have.

    python -m scripts.make_stress_clip --src IMG_0274.MOV --seconds 60 --height 2160
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / 'test-videos'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--seconds', type=float, default=60.0)
    ap.add_argument('--height', type=int, default=2160, help='0 keeps the source size')
    ap.add_argument('--fps', type=float, default=0, help='0 keeps the source fps')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    src = VIDEO_DIR / args.src
    cap = cv2.VideoCapture(str(src))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    sw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    sh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fps = args.fps or src_fps
    if args.height:
        scale = args.height / sh
        w, h = int(round(sw * scale / 2) * 2), args.height
    else:
        w, h = sw, sh

    out_path = Path(args.out) if args.out else VIDEO_DIR / (
        f'stress_{Path(args.src).stem}_{h}p_{int(args.seconds)}s.mp4')
    writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))

    want = int(args.seconds * fps)
    written = 0
    while written < want:
        ret, frame = cap.read()
        if not ret:  # loop the source until the target length is reached
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
            if not ret:
                break
        if (w, h) != (sw, sh):
            frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_LINEAR)
        writer.write(frame)
        written += 1
    writer.release()
    cap.release()

    mb = out_path.stat().st_size / 1e6
    print(f'{out_path.name}: {w}x{h} @ {fps:.0f}fps, {written} frames, '
          f'{written / fps:.1f}s, {mb:.1f} MB')


if __name__ == '__main__':
    main()
