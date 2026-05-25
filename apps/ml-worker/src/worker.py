"""Core ML SQS polling worker for Stride.

Downloads sprint videos from S3, executes MoveNet keypoint estimation,
calculates biomechanical metrics, calls Gemini for coaching insights,
and updates status via database and internal HTTP callbacks.
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

# Load env variables
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("stride-ml-worker")

# Initialize Sentry if DSN is set
sentry_dsn = os.environ.get("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.environ.get("NODE_ENV", "development"),
        traces_sample_rate=1.0,
    )
    logger.info("Sentry initialized successfully.")

# Import local modules
from src.db import get_db_connection
from src.movenet import process_video, CONFIDENCE_THRESHOLD, MOVENET_VERSION
from src.biomechanics import analyze
from src.llm import generate_sprint_report
from src.notify import notify_analysis_completed, notify_analysis_failed

# Initialize AWS clients
aws_endpoint = os.environ.get("AWS_ENDPOINT")
aws_region = os.environ.get("AWS_REGION", "us-east-1")
s3_bucket = os.environ.get("S3_BUCKET")
queue_url = os.environ.get("SQS_QUEUE_URL")

s3_client_args = {"region_name": aws_region}
sqs_client_args = {"region_name": aws_region}

if aws_endpoint:
    s3_client_args["endpoint_url"] = aws_endpoint
    # Required for LocalStack S3 simulation
    s3_client_args["config"] = boto3.session.Config(signature_version="s3v4", s3={"addressing_style": "path"})
    sqs_client_args["endpoint_url"] = aws_endpoint

s3_client = boto3.client("s3", **s3_client_args)
sqs_client = boto3.client("sqs", **sqs_client_args)


def update_analysis_status_in_db(analysis_id: str, status: str, error_message: str | None = None) -> None:
    """Helper to update database analysis status directly for state management."""
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


def process_sqs_message(message: dict) -> None:
    """Download video, extract pose, run biomechanics, query LLM, and update states."""
    message_body = json.loads(message["Body"])
    analysis_id = message_body.get("analysisId")
    s3_key = message_body.get("s3Key")

    if not analysis_id or not s3_key:
        logger.error("SQS message is missing analysisId or s3Key: %s", message_body)
        return

    logger.info("Starting processing for analysis ID: %s (Key: %s)", analysis_id, s3_key)

    # 1. Update DB to 'processing'
    update_analysis_status_in_db(analysis_id, "processing")

    local_temp_file = None

    try:
        # Create a workspace-safe temp dir if running locally, or use default temp file
        # We will use tempfile which works flawlessly in both local and docker environments
        suffix = os.path.splitext(s3_key)[1] or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_video:
            local_temp_file = temp_video.name

        # 2. Download from S3
        logger.info("Downloading video from S3: %s/%s -> %s", s3_bucket, s3_key, local_temp_file)
        s3_client.download_file(s3_bucket, s3_key, local_temp_file)

        # 3. Pose estimation
        logger.info("Running MoveNet Thunder inference...")
        raw_frames = process_video(local_temp_file, target_fps=10)

        # 4. Critical check: confidence threshold
        total_frames = len(raw_frames)
        excluded_frames = [f for f in raw_frames if f["excluded"]]
        excluded_count = len(excluded_frames)
        excluded_percentage = (excluded_count / total_frames) if total_frames > 0 else 1.0

        logger.info(
            "Confidence check: %d/%d frames excluded (%.1f%%)",
            excluded_count,
            total_frames,
            excluded_percentage * 100,
        )

        if excluded_percentage > 0.40:
            error_msg = "low_confidence_video"
            logger.warning(
                "Aborting analysis %s: %.1f%% of frames were excluded (threshold is 40%%).",
                analysis_id,
                excluded_percentage * 100,
            )
            update_analysis_status_in_db(analysis_id, "failed", error_message=error_msg)
            notify_analysis_failed(analysis_id, error_msg)
            return

        # 5. Run Biomechanics Engine
        logger.info("Executing biomechanics engine...")
        # Only pass non-excluded frames to the biomechanical analyzer
        included_frames = [f for f in raw_frames if not f["excluded"]]
        analysis_data = analyze(included_frames, target_fps=10)

        # 6. LLM synthesis (Gemini 1.5 Pro)
        logger.info("Synthesizing coaching report via LLM...")
        report = generate_sprint_report(
            analysis_summary=analysis_data["summary"],
            detected_issues=analysis_data["issues"],
        )

        # Add metric time series back to the final result JSON for interactive charts in mobile app
        full_result = report.model_dump()
        full_result["metrics"] = analysis_data["metrics"]
        full_result["phases"] = analysis_data["phases"]
        full_result["ground_contacts"] = analysis_data["ground_contacts"]
        full_result["summary"] = analysis_data["summary"]

        # 7. Finalize and trigger callback
        logger.info("Analysis complete! Triggering API callback...")
        success = notify_analysis_completed(
            analysis_id=analysis_id,
            overall_score=report.overall_score,
            result_json=full_result,
        )

        if not success:
            # If the callback failed (e.g. API server is down), we fallback to updating the DB directly
            # so the analysis isn't completely lost.
            logger.warning("Notification callback failed. Falling back to direct database writes.")
            try:
                with get_db_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(
                            "UPDATE analyses SET status = %s, overall_score = %s, result_json = %s, movenet_version = %s, completed_at = now() WHERE id = %s",
                            ("completed", report.overall_score, json.dumps(full_result), MOVENET_VERSION, analysis_id),
                        )
                logger.info("Direct database update fallback succeeded.")
            except Exception as db_err:
                logger.error("Direct database update fallback failed: %s", db_err)
                raise ValueError("Both HTTP callback and DB fallback failed.")

    except Exception as err:
        logger.error("Error processing analysis %s: %s", analysis_id, err)
        traceback.print_exc()
        sentry_sdk.capture_exception(err)
        
        # Mark as failed in DB and call callback
        error_str = str(err)
        update_analysis_status_in_db(analysis_id, "failed", error_message=error_str)
        notify_analysis_failed(analysis_id, error_str)
    
    finally:
        # Clean up temp video file
        if local_temp_file and os.path.exists(local_temp_file):
            try:
                os.remove(local_temp_file)
                logger.info("Removed temporary video file: %s", local_temp_file)
            except Exception as e:
                logger.error("Failed to delete temp file %s: %s", local_temp_file, e)


def start_worker() -> None:
    """SQS Polling Loop."""
    if not queue_url:
        logger.error("SQS_QUEUE_URL environment variable is not configured. Exiting.")
        sys.exit(1)

    logger.info("Starting Stride ML Worker polling loop on: %s", queue_url)
    
    # Simple heartbeat indicator
    last_heartbeat = time.time()

    while True:
        try:
            if time.time() - last_heartbeat > 60:
                logger.info("[Heartbeat] Polling SQS for jobs...")
                last_heartbeat = time.time()

            # Poll for messages with 20s long-polling
            response = sqs_client.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,
                AttributeNames=["All"],
            )

            messages = response.get("Messages", [])
            for message in messages:
                receipt_handle = message["ReceiptHandle"]
                try:
                    process_sqs_message(message)
                finally:
                    # Always delete the message from the queue after processing
                    # so we don't trigger the redrive DLQ policy or loop endlessly.
                    sqs_client.delete_message(
                        QueueUrl=queue_url,
                        ReceiptHandle=receipt_handle,
                    )
                    logger.info("Successfully deleted message from SQS.")

        except Exception as poll_err:
            logger.error("Error in polling loop: %s", poll_err)
            sentry_sdk.capture_exception(poll_err)
            time.sleep(5)  # Backoff to prevent spamming logs in case of network issue


if __name__ == "__main__":
    start_worker()
