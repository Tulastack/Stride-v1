"""Core ML SQS polling worker for Stride.

Pipeline (PRD v2.2-B):
  Stage 0  — capture sidecar (gyro + intrinsics)
  Stage 1  — MoveNet 2D keypoints
  Stage 2  — WHAM monocular 3D lift (SMPL in gravity frame)
  Stage 3  — OpenCap-Monocular skeleton refinement
  Stage 4–7 — API assembles canonical metrics + flaws from 3D frames
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import time
import traceback
import boto3
import sentry_sdk
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("stride-ml-worker")

sentry_dsn = os.environ.get("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.environ.get("NODE_ENV", "development"),
        traces_sample_rate=1.0,
    )
    logger.info("Sentry initialized successfully.")

from src.db import get_db_connection
from src.pose2d import process_video
from src.movenet import CONFIDENCE_THRESHOLD, MOVENET_VERSION
from src.biomechanics import analyze
from src.llm import generate_sprint_report
from src.notify import (
    notify_analysis_completed,
    notify_analysis_failed,
    notify_biomech_completed,
    notify_progress,
)
from src.capture_loader import download_capture_sidecar
from src.pipeline3d import run_pipeline_3d, _estimate_azimuth
from src.frames3d_io import write_frames_sidecar
from src.pose2d import stream_frames
from src.biomech2d import analyze_2d_sagittal_stream

# Initialize AWS clients
aws_endpoint = os.environ.get("AWS_ENDPOINT")
aws_region = os.environ.get("AWS_REGION", "us-east-1")
s3_bucket = os.environ.get("S3_BUCKET")
queue_url = os.environ.get("SQS_QUEUE_URL")

s3_client_args = {"region_name": aws_region}
sqs_client_args = {"region_name": aws_region}

if aws_endpoint:
    s3_client_args["endpoint_url"] = aws_endpoint
    s3_client_args["config"] = boto3.session.Config(signature_version="s3v4", s3={"addressing_style": "path"})
    sqs_client_args["endpoint_url"] = aws_endpoint

s3_client = boto3.client("s3", **s3_client_args)
sqs_client = boto3.client("sqs", **sqs_client_args)

# Docker-free local mode: read videos from a shared dir, poll the DB for jobs.
STORAGE_DRIVER = os.environ.get("STORAGE_DRIVER", "s3").lower()
LOCAL_STORAGE = STORAGE_DRIVER == "local"
LOCAL_STORAGE_DIR = os.environ.get("LOCAL_STORAGE_DIR", "/tmp/stride-local-storage")

# Pipeline selection:
#   STRIDE_PIPELINE=2d      (default) — RTMPose + 2D sagittal biomechanics. The
#                           production path: accurate sagittal angles from a good
#                           2D backbone, no fragile monocular 3D lift. CPU-friendly.
#   STRIDE_PIPELINE=wham    — MoveNet/RTMPose + WHAM 3D lift (needs GPU + STRIDE_WHAM_REPO)
#   STRIDE_PIPELINE=legacy  — old 2D + Gemini LLM report
PIPELINE = os.environ.get("STRIDE_PIPELINE", "2d").lower()
USE_WHAM_OPENCAP = PIPELINE == "wham"


def update_analysis_status_in_db(analysis_id: str, status: str, error_message: str | None = None) -> None:
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                if status == "processing":
                    cursor.execute(
                        "UPDATE analyses SET status = %s WHERE id = %s",
                        (status, analysis_id),
                    )
                elif status == "failed":
                    cursor.execute(
                        "UPDATE analyses SET status = %s, error_message = %s, completed_at = now() WHERE id = %s",
                        (status, error_message, analysis_id),
                    )
    except Exception as err:
        logger.error(
            "Failed to update database status directly for %s to %s: %s",
            analysis_id,
            status,
            err,
        )


def _upload_frames_sidecar(s3_key: str, pipeline_result: dict) -> None:
    sidecar_key = s3_key.rsplit(".", 1)[0] + ".frames3d.json"
    body = json.dumps(pipeline_result)
    s3_client.put_object(
        Bucket=s3_bucket,
        Key=sidecar_key,
        Body=body,
        ContentType="application/json",
    )
    logger.info("Uploaded frames3d sidecar to s3://%s/%s", s3_bucket, sidecar_key)


def _write_overlay(video_path: str, s3_key: str | None, payload: dict) -> None:
    """Persist the per-frame keypoint overlay next to the video so the app can
    fetch it and draw the skeleton in sync with playback."""
    body = json.dumps(payload)
    if LOCAL_STORAGE:
        path = os.path.splitext(video_path)[0] + ".overlay.json"
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        logger.info("Wrote overlay sidecar %s (%d frames)", path, len(payload.get("frames", [])))
    elif s3_key:
        key = os.path.splitext(s3_key)[0] + ".overlay.json"
        s3_client.put_object(Bucket=s3_bucket, Key=key, Body=body, ContentType="application/json")
        logger.info("Uploaded overlay sidecar s3://%s/%s", s3_bucket, key)


def _image_down_from_capture(capture: dict) -> tuple[float, float] | None:
    """Project phone gravity into image [y, x] for gravity-anchored 2D angles.

    Prefers an explicit `imageGravity2D` from the capture layer. Otherwise
    approximates from mean accelerometer (portrait: device y ≈ -image y).
    Full device→camera extrinsic calibration is Phase 0; this is the honest
    Phase 1 approximation for pitch/roll tilt of trunk/knee angles.
    """
    ig = capture.get("imageGravity2D")
    if isinstance(ig, (list, tuple)) and len(ig) >= 2:
        return (float(ig[0]), float(ig[1]))
    accel = capture.get("accelerometer") or []
    if not accel:
        return None
    xs, ys = [], []
    for s in accel:
        if not isinstance(s, dict):
            continue
        xs.append(float(s.get("ax", s.get("x", 0.0))))
        ys.append(float(s.get("ay", s.get("y", 0.0))))
    if not xs:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    # Expo/device: +y is up when phone is upright → image +y is down → negate y.
    mag = (mx * mx + my * my) ** 0.5
    if mag < 1e-6:
        return None
    return (-my / mag, mx / mag)


def _run_2d(analysis_id: str, video_path: str, capture: dict, s3_key: str | None = None) -> None:
    """RTMPose 2D keypoints -> 2D sagittal biomechanics -> AnalysisResult.

    Streaming: frames are consumed one at a time and reduced to scalar series, so
    peak memory is bounded regardless of clip length (no full keypoint buffer)."""
    capture_fps = float(capture.get("fps") or capture.get("preferredFps") or 30)
    notify_progress(analysis_id, "pose_extraction", 30, "RTMPose 2D keypoints")
    os.environ.setdefault("POSE2D_BACKEND", "rtmpose")
    azimuth = float(capture["cameraAzimuthDeg"]) if capture.get("cameraAzimuthDeg") is not None else 20.0

    # Speed: sample pose at a lower fps (angles don't need 30/60fps). Keep
    # capture_fps separate for trust gating / quality nudges.
    pose_fps = int(os.environ.get("POSE_FPS", "15"))
    eff_fps = float(min(pose_fps, capture_fps))

    import cv2
    _cap = cv2.VideoCapture(video_path)
    source_fps = float(_cap.get(cv2.CAP_PROP_FPS) or capture_fps)
    if source_fps <= 1e-3:
        source_fps = capture_fps
    vw, vh = int(_cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    _cap.release()

    # Target lock: if the user selected a runner, crop-track THAT person. Accept
    # either a brush bbox {x0,y0,x1,y1} (preferred) or a point {xNorm,yNorm}.
    tgt = capture.get("target")
    target_xy = None
    if isinstance(tgt, dict):
        if all(tgt.get(k) is not None for k in ("x0", "y0", "x1", "y1")):
            target_xy = (float(tgt["x0"]), float(tgt["y0"]), float(tgt["x1"]), float(tgt["y1"]))
            logger.info("Target lock: brush bbox %s", target_xy)
        elif tgt.get("xNorm") is not None and tgt.get("yNorm") is not None:
            target_xy = (float(tgt["xNorm"]), float(tgt["yNorm"]))
            logger.info("Target lock: point (%.2f, %.2f)", *target_xy)

    image_down = _image_down_from_capture(capture)
    if image_down:
        logger.info("Gravity-anchored image_down=%s", image_down)

    notify_progress(analysis_id, "biomechanics_calculation", 75, "2D sagittal biomechanics")
    overlay_frames: list = []
    result = analyze_2d_sagittal_stream(
        stream_frames(video_path, target_fps=pose_fps, target=target_xy),
        fps=eff_fps, azimuth_deg=azimuth, clip_id=analysis_id[:8],
        overlay_out=overlay_frames,
        source_fps=source_fps,
        capture_fps=capture_fps,
        image_down=image_down,
    )
    _write_overlay(video_path, s3_key, {
        "fps": eff_fps,
        "sourceFps": source_fps,
        "width": vw,
        "height": vh,
        "frames": overlay_frames,
    })
    overall_score = int(round(result["captureQuality"]["overall"] * 100))

    # Backend-derived model identity (bug B3): the persisted model version must
    # reflect the backend that ACTUALLY ran, not a hardcoded MoveNet string. This
    # rides inside result_json so both the API callback and the DB fallback use it.
    pose_backend = os.environ.get("POSE2D_BACKEND", "rtmpose")
    rtmpose_mode = os.environ.get("RTMPOSE_MODE", "balanced")
    model_version = f"rtmpose-{rtmpose_mode}" if pose_backend == "rtmpose" else pose_backend
    result["model_meta"] = {
        "backend": pose_backend,
        "model_version": model_version,
        "detector": "yolox" if pose_backend == "rtmpose" else "none",
        "device": "cpu",
        "poseFps": pose_fps,
        "pipeline": "2d-sagittal",
    }

    notify_progress(analysis_id, "finalizing", 95, "Complete")
    ok = notify_analysis_completed(analysis_id, overall_score, result)
    if not ok:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE analyses SET status='completed', overall_score=%s, result_json=%s, movenet_version=%s, completed_at=now() WHERE id=%s",
                    (overall_score, json.dumps(result), model_version, analysis_id),
                )


def _process_2d_sagittal(analysis_id: str, s3_key: str, local_video: str) -> None:
    """SQS path: download the capture sidecar from S3, then run 2D biomechanics."""
    capture = download_capture_sidecar(s3_client, s3_bucket, s3_key, local_video)
    _run_2d(analysis_id, local_video, capture, s3_key)


def _process_wham_opencap(analysis_id: str, s3_key: str, local_video: str) -> None:
    capture = download_capture_sidecar(s3_client, s3_bucket, s3_key, local_video)

    notify_progress(analysis_id, "pose_extraction", 25, "MoveNet Stage 1")
    raw_frames = process_video(local_video, target_fps=30)
    included = [f for f in raw_frames if not f["excluded"]]
    total = len(raw_frames)
    excluded_pct = (len(raw_frames) - len(included)) / total if total else 1.0
    if excluded_pct > 0.40:
        raise ValueError("low_confidence_video")

    notify_progress(analysis_id, "wham_reconstruction", 45, "WHAM Stage 2 — monocular 3D lift")
    pipeline_result = run_pipeline_3d(local_video, included, capture)
    pipeline_result["motionBlur"] = capture.get("motionBlur", "med")
    pipeline_result["framing"] = capture.get("framing", "full")

    notify_progress(analysis_id, "skeleton_fit", 65, f"OpenCap Stage 3 — {pipeline_result.get('stage3Backend')}")
    sidecar_local = local_video + ".frames3d.json"
    write_frames_sidecar(sidecar_local, pipeline_result)
    _upload_frames_sidecar(s3_key, pipeline_result)

    notify_progress(analysis_id, "biomechanics_calculation", 85, "Canonical metrics Stages 4–7")
    ok = notify_biomech_completed(analysis_id, pipeline_result)
    if not ok:
        raise ValueError("Biomech API callback failed")

    notify_progress(analysis_id, "finalizing", 98, "Complete")


def _process_legacy_llm(analysis_id: str, local_video: str) -> None:
    notify_progress(analysis_id, "pose_extraction", 30)
    raw_frames = process_video(local_video, target_fps=10)
    included = [f for f in raw_frames if not f["excluded"]]
    if len(raw_frames) and (len(raw_frames) - len(included)) / len(raw_frames) > 0.40:
        raise ValueError("low_confidence_video")

    notify_progress(analysis_id, "biomechanics_calculation", 60)
    analysis_data = analyze(included, target_fps=10)

    notify_progress(analysis_id, "llm_structuring", 80)
    report = generate_sprint_report(
        analysis_summary=analysis_data["summary"],
        detected_issues=analysis_data["issues"],
    )
    full_result = report.model_dump()
    full_result["metrics"] = analysis_data["metrics"]
    full_result["phases"] = analysis_data["phases"]
    full_result["ground_contacts"] = analysis_data["ground_contacts"]
    full_result["summary"] = analysis_data["summary"]

    notify_progress(analysis_id, "finalizing", 95)
    success = notify_analysis_completed(analysis_id, report.overall_score, full_result)
    if not success:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE analyses SET status = %s, overall_score = %s, result_json = %s, movenet_version = %s, completed_at = now() WHERE id = %s",
                    ("completed", report.overall_score, json.dumps(full_result), MOVENET_VERSION, analysis_id),
                )


def process_sqs_message(message: dict) -> None:
    message_body = json.loads(message["Body"])
    analysis_id = message_body.get("analysisId")
    s3_key = message_body.get("s3Key")

    if not analysis_id or not s3_key:
        logger.error("SQS message is missing analysisId or s3Key: %s", message_body)
        return

    logger.info("Starting processing for analysis ID: %s (Key: %s)", analysis_id, s3_key)
    update_analysis_status_in_db(analysis_id, "processing")

    local_temp_file = None
    try:
        suffix = os.path.splitext(s3_key)[1] or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_video:
            local_temp_file = temp_video.name

        notify_progress(analysis_id, "downloading", 10)
        s3_client.download_file(s3_bucket, s3_key, local_temp_file)

        if PIPELINE == "wham":
            logger.info("Running WHAM + OpenCap pipeline (Stages 2–3)")
            _process_wham_opencap(analysis_id, s3_key, local_temp_file)
        elif PIPELINE == "legacy":
            logger.info("Running legacy 2D + LLM pipeline")
            _process_legacy_llm(analysis_id, local_temp_file)
        else:
            logger.info("Running RTMPose + 2D sagittal biomechanics pipeline")
            _process_2d_sagittal(analysis_id, s3_key, local_temp_file)

    except Exception as err:
        logger.error("Error processing analysis %s: %s", analysis_id, err)
        traceback.print_exc()
        sentry_sdk.capture_exception(err)
        update_analysis_status_in_db(analysis_id, "failed", error_message=str(err))
        notify_analysis_failed(analysis_id, str(err))

    finally:
        if local_temp_file and os.path.exists(local_temp_file):
            try:
                os.remove(local_temp_file)
            except Exception as e:
                logger.error("Failed to delete temp file %s: %s", local_temp_file, e)


def _read_local_capture(s3_key: str) -> dict:
    """Read the capture sidecar written by the API in local mode (if any)."""
    sidecar = os.path.join(LOCAL_STORAGE_DIR, os.path.splitext(s3_key)[0] + ".capture.json")
    if os.path.exists(sidecar):
        try:
            with open(sidecar, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Failed to read local capture sidecar: %s", e)
    return {}


def _process_local(analysis_id: str, s3_key: str) -> None:
    """Local mode: the video is already on disk (shared dir); run 2D biomechanics."""
    video_path = os.path.join(LOCAL_STORAGE_DIR, s3_key)
    try:
        if not os.path.exists(video_path):
            raise ValueError(f"video not found in local storage: {video_path}")
        capture = _read_local_capture(s3_key)
        if PIPELINE == "wham":
            _process_wham_opencap(analysis_id, s3_key, video_path)
        elif PIPELINE == "legacy":
            _process_legacy_llm(analysis_id, video_path)
        else:
            _run_2d(analysis_id, video_path, capture, s3_key)
    except Exception as err:
        logger.error("Error processing (local) analysis %s: %s", analysis_id, err)
        traceback.print_exc()
        sentry_sdk.capture_exception(err)
        update_analysis_status_in_db(analysis_id, "failed", error_message=str(err))
        notify_analysis_failed(analysis_id, str(err))


def _claim_pending():
    """Atomically claim the next pending analysis (FOR UPDATE SKIP LOCKED)."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE analyses SET status='processing'
                WHERE id = (
                    SELECT id FROM analyses WHERE status='pending'
                    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                RETURNING id, s3_key
                """
            )
            return cur.fetchone()


def _start_local_worker() -> None:
    logger.info("Starting Stride ML Worker (LOCAL DB-poll, pipeline=%s) dir=%s", PIPELINE, LOCAL_STORAGE_DIR)
    last_heartbeat = time.time()
    while True:
        try:
            if time.time() - last_heartbeat > 60:
                logger.info("[Heartbeat] Polling DB for pending analyses...")
                last_heartbeat = time.time()
            row = _claim_pending()
            if row:
                analysis_id, s3_key = str(row[0]), row[1]
                logger.info("Claimed analysis %s (key: %s)", analysis_id, s3_key)
                _process_local(analysis_id, s3_key)
            else:
                time.sleep(2)
        except Exception as poll_err:
            logger.error("Error in DB poll loop: %s", poll_err)
            sentry_sdk.capture_exception(poll_err)
            time.sleep(3)


def start_worker() -> None:
    if LOCAL_STORAGE:
        _start_local_worker()
        return

    if not queue_url:
        logger.error("SQS_QUEUE_URL environment variable is not configured. Exiting.")
        sys.exit(1)

    logger.info(
        "Starting Stride ML Worker (WHAM+OpenCap=%s) on: %s",
        USE_WHAM_OPENCAP,
        queue_url,
    )
    last_heartbeat = time.time()

    while True:
        try:
            if time.time() - last_heartbeat > 60:
                logger.info("[Heartbeat] Polling SQS for jobs...")
                last_heartbeat = time.time()

            response = sqs_client.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,
                AttributeNames=["All"],
            )

            for message in response.get("Messages", []):
                receipt_handle = message["ReceiptHandle"]
                try:
                    process_sqs_message(message)
                finally:
                    sqs_client.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)

        except Exception as poll_err:
            logger.error("Error in polling loop: %s", poll_err)
            sentry_sdk.capture_exception(poll_err)
            time.sleep(5)


if __name__ == "__main__":
    start_worker()
