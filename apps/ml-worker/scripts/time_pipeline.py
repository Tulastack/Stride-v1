"""Stage-level timing for the analysis pipeline, on the real test clips.

Runs the same calls `worker._run_2d` / `worker._run_3d_geo` make, with a timer
round each stage, so "analysis is slow" turns into a number per stage rather
than a feeling. Nothing here is production code; it only measures it.

    python -m scripts.time_pipeline --pipeline 3d-geo --clip IMG_8267.MOV
    python -m scripts.time_pipeline --pipeline 2d --all

Model load is reported separately from analysis: it is a one-time cost per
worker process, not per clip, so folding it into per-clip latency would flatter
a warm worker and slander a cold one.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / 'test-videos'

os.environ.setdefault('POSE2D_BACKEND', 'rtmpose')
os.environ.setdefault('RTMPOSE_MODE', 'lightweight')
os.environ.setdefault('POSE_FPS', '15')
os.environ.setdefault('STORAGE_DRIVER', 'local')

MAX_SECONDS = float(os.environ.get('MAX_ANALYSIS_SECONDS', '12'))

TIMINGS: list[tuple[str, float]] = []


@contextmanager
def stage(name: str):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        TIMINGS.append((name, time.perf_counter() - t0))


def clip_meta(path: Path) -> dict:
    import cv2
    cap = cv2.VideoCapture(str(path))
    meta = {
        'fps': float(cap.get(cv2.CAP_PROP_FPS) or 30),
        'frames': int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
        'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0),
        'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0),
    }
    cap.release()
    meta['duration'] = meta['frames'] / max(meta['fps'], 1e-6)
    return meta


def run(video: Path, pipeline: str) -> dict:
    TIMINGS.clear()
    from src.pose2d import stream_frames

    meta = clip_meta(video)
    capture = {'fps': meta['fps'], 'widthPx': meta['width'], 'heightPx': meta['height']}
    pose_fps = int(os.environ['POSE_FPS'])
    eff_fps = float(min(pose_fps, meta['fps']))

    wall0 = time.perf_counter()

    # ── Stage 1: 2D pose extraction. Shared by both pipelines. The two limits
    #    mirror worker._run_3d_geo exactly, so a cap change can be checked here.
    max_frames = max(64, int(round(MAX_SECONDS * eff_fps)))
    hard_cap = int(max_frames * 1.5)
    frames: list = []
    timing_signal: list = []
    n_usable = 0
    with stage('pose_extraction'):
        for f in stream_frames(str(video), target_fps=pose_fps, target=None,
                               timing_out=timing_signal):
            frames.append(f)
            if not f.get('excluded'):
                n_usable += 1
                if n_usable >= max_frames:
                    break
            if len(frames) >= hard_cap:
                break
    included = [f for f in frames if not f.get('excluded')]

    out = {
        'clip': video.name,
        'pipeline': pipeline,
        'video_s': round(meta['duration'], 2),
        'resolution': f"{meta['width']}x{meta['height']}",
        'source_fps': round(meta['fps'], 2),
        'pose_frames': len(included),
    }

    if len(included) < 4:
        out['error'] = 'low_confidence_video'
        out['stages'] = [(n, round(s, 2)) for n, s in TIMINGS]
        out['analysis_s'] = round(time.perf_counter() - wall0, 2)
        return out

    keypoints = [f['keypoints'] for f in included]

    if pipeline == '2d':
        from src.biomech2d import analyze_2d_sagittal_stream
        with stage('biomech_2d'):
            res = analyze_2d_sagittal_stream(
                iter(included), eff_fps, 20.0, 'timing',
                source_fps=meta['fps'], capture_fps=meta['fps'],
            )
        out['metrics'] = {
            m['key']: round(float(m['measured']['value']), 3)
            for m in (res.get('metrics') or []) if m.get('measured')
        }
        out['economyScore'] = res.get('economyScore')
    else:
        from src.lift3d import lift_sequence, gravity_up_from_capture, apparent_scale
        from src.analyze3d import analyze_3d_multisegment

        up = gravity_up_from_capture(capture)
        with stage('apparent_scale'):
            scale = apparent_scale(keypoints, meta['width'] or 1080, meta['height'] or 1920)
        out['apparent_scale'] = round(scale, 4)

        with stage('lift_sequence'):
            poses, conf, lift_quality = lift_sequence(
                keypoints, intrinsics=None,
                width=meta['width'] or 1080, height=meta['height'] or 1920,
                up_hint=up,
            )
        out['closingRelTorso'] = round(float(lift_quality['closingRelTorso']), 3)
        out['reconConf'] = round(float(lift_quality['reconConf']), 3)

        with stage('analyze_3d_multisegment'):
            res = analyze_3d_multisegment(
                poses, conf, fps=eff_fps, up_world=up,
                source_fps=meta['fps'], capture_fps=meta['fps'],
                timing_signal=timing_signal, timing_fps=meta['fps'],
                recon_conf=lift_quality['reconConf'], clip_id='timing',
            )
        # The measured angles, so a speed change can be checked against the
        # numbers the athlete actually sees rather than assumed harmless.
        out['metrics'] = {
            m['key']: round(float(m['measured']['value']), 3)
            for m in (res.get('metrics') or []) if m.get('measured')
        }
        out['economyScore'] = res.get('economyScore')

    out['analysis_s'] = round(time.perf_counter() - wall0, 2)
    out['x_realtime'] = round(out['analysis_s'] / max(meta['duration'], 1e-6), 2)
    out['stages'] = [(n, round(s, 2)) for n, s in TIMINGS]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pipeline', default='3d-geo', choices=['2d', '3d-geo'])
    ap.add_argument('--clip', default=None)
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--json-out', default=None)
    args = ap.parse_args()

    if args.all:
        clips = sorted(p for p in VIDEO_DIR.iterdir()
                       if p.suffix.lower() in {'.mov', '.mp4'})
    elif args.clip:
        clips = [VIDEO_DIR / args.clip]
    else:
        ap.error('pass --clip NAME or --all')

    # Model load is a one-time process cost. Pay it here so it does not land
    # inside the first clip's number.
    t0 = time.perf_counter()
    from src.pose2d import stream_frames  # noqa: F401
    import src.rtmpose_backend as rb
    if hasattr(rb, '_get_model'):
        try:
            rb._get_model()
        except Exception:
            pass
    print(f'model/import load: {time.perf_counter() - t0:.2f}s '
          f'(pipeline={args.pipeline}, mode={os.environ["RTMPOSE_MODE"]}, '
          f'pose_fps={os.environ["POSE_FPS"]}, '
          f'det_interval={os.environ.get("RTMPOSE_DET_INTERVAL", "4")})\n')

    results = []
    for clip in clips:
        if not clip.exists():
            print(f'{clip.name}: MISSING')
            continue
        r = run(clip, args.pipeline)
        results.append(r)
        stages = '  '.join(f'{n}={s}s' for n, s in r['stages'])
        print(f"{r['clip']:26} {r['video_s']:6.1f}s video -> "
              f"{r['analysis_s']:6.1f}s analysis ({r.get('x_realtime', '?')}x)  {stages}"
              + (f"  ERROR={r['error']}" if 'error' in r else ''))
        sys.stdout.flush()

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
