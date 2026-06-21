"""Load Stage 0 capture manifest (gyro + intrinsics) from disk or S3 sidecar."""

from __future__ import annotations

import json
import logging
from typing import Any

import boto3

logger = logging.getLogger(__name__)


def default_manifest(video_path: str) -> dict[str, Any]:
    return {
        "videoPath": video_path,
        "fps": 60,
        "preferredFps": 120,
        "widthPx": 1080,
        "heightPx": 1920,
        "durationMs": 4000,
        "motionBlur": "med",
        "framing": "full",
        "handheld": True,
        "gyro": [],
        "cameraAzimuthDeg": 25.0,
    }


def load_capture_manifest_local(video_path: str) -> dict[str, Any]:
    base = video_path.rsplit(".", 1)[0]
    for path in (f"{base}.capture.json", f"{base}.gyro.json"):
        try:
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
            out = default_manifest(video_path)
            out.update(raw)
            out["videoPath"] = video_path
            return out
        except FileNotFoundError:
            continue
        except json.JSONDecodeError as err:
            logger.warning("Invalid capture sidecar %s: %s", path, err)
    return default_manifest(video_path)


def download_capture_sidecar(
    s3_client: Any,
    bucket: str,
    video_key: str,
    local_video_path: str,
) -> dict[str, Any]:
    sidecar_key = video_key.rsplit(".", 1)[0] + ".capture.json"
    local_sidecar = local_video_path.rsplit(".", 1)[0] + ".capture.json"
    try:
        s3_client.download_file(bucket, sidecar_key, local_sidecar)
        with open(local_sidecar, encoding="utf-8") as f:
            raw = json.load(f)
        out = default_manifest(local_video_path)
        out.update(raw)
        out["videoPath"] = local_video_path
        logger.info("Loaded capture sidecar from s3://%s/%s", bucket, sidecar_key)
        return out
    except Exception as err:
        logger.info("No capture sidecar at %s (%s); using defaults", sidecar_key, err)
        return load_capture_manifest_local(local_video_path)
