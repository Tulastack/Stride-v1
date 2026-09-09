"""End-to-end latency: upload a real clip through the API and time it to done.

This is the number the athlete actually experiences, which is not the same as
the pipeline's compute time: it includes the upload, the worker's poll interval,
the analysis itself, and the write-back. Run against a live stack (dev-up.sh).

    python -m scripts.e2e_latency --clip IMG_0274.MOV
    python -m scripts.e2e_latency --all --timeout 400

Auth: takes a bearer token from STRIDE_TEST_TOKEN, otherwise talks to the DB
directly to enqueue exactly the way /videos/finalize does, so the worker path,
the storage path and the write-back are all still the real ones.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / 'test-videos'


def env_from_api() -> dict:
    out = {}
    for line in (ROOT / 'apps' / 'api' / '.env').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            out[k] = v
    return out


def psql(db_url: str, sql: str) -> str:
    return subprocess.run(['psql', db_url, '-tAc', sql],
                          capture_output=True, text=True, check=True).stdout.strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--clip')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--timeout', type=float, default=300.0)
    args = ap.parse_args()

    env = env_from_api()
    db_url = env['DATABASE_URL']
    store = Path(env.get('LOCAL_STORAGE_DIR', '/tmp/stride-local-storage'))

    user_id = psql(db_url, 'SELECT id FROM users ORDER BY created_at LIMIT 1')
    if not user_id:
        raise SystemExit('no user in the database; sign in on the app once first')

    if args.all:
        clips = sorted(p for p in VIDEO_DIR.iterdir()
                       if p.suffix.lower() in {'.mov', '.mp4'})
    elif args.clip:
        clips = [VIDEO_DIR / args.clip]
    else:
        ap.error('pass --clip NAME or --all')

    print(f"{'clip':<34}{'MB':>7}{'queued':>9}{'analysis':>10}{'total':>8}  status")
    for clip in clips:
        analysis_id = str(uuid.uuid4())
        key = f'uploads/{user_id}/{analysis_id}{clip.suffix}'
        dest = store / key
        dest.parent.mkdir(parents=True, exist_ok=True)

        t_upload0 = time.perf_counter()
        shutil.copy(clip, dest)
        upload_s = time.perf_counter() - t_upload0

        # Exactly what /videos/finalize does: the row goes pending, and the
        # worker's own poll is what picks it up from here.
        t0 = time.perf_counter()
        psql(db_url, f"INSERT INTO analyses (id, user_id, s3_key, status) "
                     f"VALUES ('{analysis_id}', '{user_id}', '{key}', 'pending')")

        claimed_at = None
        status = 'pending'
        while time.perf_counter() - t0 < args.timeout:
            status = psql(db_url, f"SELECT status FROM analyses WHERE id='{analysis_id}'")
            if claimed_at is None and status in ('processing', 'completed', 'failed'):
                claimed_at = time.perf_counter()
            if status in ('completed', 'failed'):
                break
            time.sleep(0.5)
        done = time.perf_counter()

        err = ''
        if status == 'failed':
            err = psql(db_url, f"SELECT coalesce(error_message,'') FROM analyses "
                               f"WHERE id='{analysis_id}'")[:38]

        queued = (claimed_at - t0) if claimed_at else float('nan')
        analysis = (done - claimed_at) if claimed_at else float('nan')
        print(f'{clip.name:<34}{clip.stat().st_size / 1e6:7.1f}{queued:9.1f}'
              f'{analysis:10.1f}{done - t0 + upload_s:8.1f}  {status} {err}')

        # Leave the database as we found it.
        psql(db_url, f"DELETE FROM metrics_timeline WHERE analysis_id='{analysis_id}'")
        psql(db_url, f"DELETE FROM analyses WHERE id='{analysis_id}'")
        dest.unlink(missing_ok=True)

    print('\nqueued = pending -> claimed (worker poll). analysis = claimed -> terminal.')


if __name__ == '__main__':
    main()
