"""Split one `body(frame)` call into detector vs pose, and try the knobs.

rtmlib's Body wrapper runs YOLOX then RTMPose. Which of the two dominates
decides the fix: a cheaper detector cadence, or a smaller pose model.

    python -m scripts.time_inference --clip IMG_0271.MOV --frames 40
"""
from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

import cv2
import numpy as np

os.environ.setdefault('RTMPOSE_MODE', 'lightweight')

ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / 'test-videos'


def grab(path: str, count: int, stride: int = 2) -> list[np.ndarray]:
    cap = cv2.VideoCapture(path)
    out, i = [], 0
    while len(out) < count:
        ret, frame = cap.read()
        if not ret:
            break
        if i % stride == 0:
            out.append(frame)
        i += 1
    cap.release()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--clip', required=True)
    ap.add_argument('--frames', type=int, default=40)
    args = ap.parse_args()

    from src.rtmpose_backend import _load_body, _maybe_downscale
    import onnxruntime as ort

    body = _load_body()
    det = getattr(body, 'det_model', None)
    pose = getattr(body, 'pose_model', None)
    print('rtmlib Body parts:', type(det).__name__, '+', type(pose).__name__)
    for name, m in (('det', det), ('pose', pose)):
        sess = getattr(m, 'session', None)
        if sess is not None:
            opts = sess.get_session_options()
            print(f'  {name}: providers={sess.get_providers()} '
                  f'intra_op={opts.intra_op_num_threads} inter_op={opts.inter_op_num_threads} '
                  f'input={sess.get_inputs()[0].shape}')
    print('  cpu count:', os.cpu_count(), ' ort:', ort.__version__)

    frames = grab(str(VIDEO_DIR / args.clip), args.frames)
    print(f'\n{args.clip}: {len(frames)} frames at {frames[0].shape[1]}x{frames[0].shape[0]}')

    small = [_maybe_downscale(f)[0] for f in frames]
    print(f'inference input after downscale: {small[0].shape[1]}x{small[0].shape[0]} '
          f'(RTMPOSE_MAX_DIM={os.environ.get("RTMPOSE_MAX_DIM", "640")})')

    # Warm up: the first call absorbs graph init and would skew the mean.
    body(small[0])

    t_det = t_pose = t_all = 0.0
    n_people = []
    for f in small:
        t0 = time.perf_counter()
        boxes = det(f)
        t_det += time.perf_counter() - t0
        n_people.append(len(boxes))

        t0 = time.perf_counter()
        pose(f, bboxes=boxes)
        t_pose += time.perf_counter() - t0

        t0 = time.perf_counter()
        body(f)
        t_all += time.perf_counter() - t0

    n = len(small)
    print(f'\n{"stage":<22}{"ms/frame":>10}{"share":>9}')
    print(f'{"YOLOX detector":<22}{1000 * t_det / n:10.1f}{100 * t_det / (t_det + t_pose):8.0f}%')
    print(f'{"RTMPose keypoints":<22}{1000 * t_pose / n:10.1f}{100 * t_pose / (t_det + t_pose):8.0f}%')
    print(f'{"body() end to end":<22}{1000 * t_all / n:10.1f}')
    print(f'people detected per frame: min={min(n_people)} max={max(n_people)} '
          f'mean={sum(n_people) / n:.1f}')


if __name__ == '__main__':
    main()
