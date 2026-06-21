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
from src.movenet import process_video, CONFIDENCE_THRESHOLD, MOVENET_VERSION
from src.biomechanics import analyze
from src.llm import generate_sprint_report
from src.notify import (
    notify_analysis_completed,
    notify_analysis_failed,
    notify_biomech_completed,
    notify_progress,
)
from src.capture_loader import download_capture_sidecar
from src.pipeline3d import run_pipeline_3d
from src.frames3d_io import write_frames_sidecar

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

# WHAM+OpenCap is the default production path (set STRIDE_LEGACY_PIPELINE=1 for old LLM flow)
USE_WHAM_OPENCAP = os.environ.get("STRIDE_LEGACY_PIPELINE", "0") != "1"


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

        if USE_WHAM_OPENCAP:
            logger.info("Running WHAM + OpenCap pipeline (Stages 2–3)")
            _process_wham_opencap(analysis_id, s3_key, local_temp_file)
        else:
            logger.info("Running legacy 2D + LLM pipeline")
            _process_legacy_llm(analysis_id, local_temp_file)

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


def start_worker() -> None:
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
