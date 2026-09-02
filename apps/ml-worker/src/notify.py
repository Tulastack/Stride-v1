"""Notification client for reporting analysis results to the Express API server."""

from __future__ import annotations

import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

# NOTE: these callbacks deliberately do NOT follow redirects. A 3xx from this
# endpoint means something other than the Stride API is listening on the port —
# and requests' default redirect-following turned that into a 200, so the worker
# logged "Successfully reported", skipped its own DB-write fallback, and the
# finished analysis was silently lost. Observed for real when another project
# was serving :3000 and redirected to its own sign-in page.
API_SERVER_URL = os.environ.get("API_SERVER_URL", "http://localhost:3000")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")
if not INTERNAL_API_SECRET:
    logger.warning(
        "INTERNAL_API_SECRET is not set — completion/progress callbacks will be "
        "rejected by any API running with internal auth enforced."
    )


def notify_progress(analysis_id: str, stage: str, pct: int, message: str = "") -> None:
    """POST /internal/analysis-progress with stage update."""
    try:
        resp = requests.post(
            f"{API_SERVER_URL}/internal/analysis-progress",
            json={"analysisId": analysis_id, "stage": stage, "pct": pct, "message": message},
            headers={"X-Internal-Token": INTERNAL_API_SECRET},
            timeout=5,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"Progress notification failed: {e}")


def notify_biomech_completed(analysis_id: str, pipeline3d: dict[str, Any]) -> bool:
    """POST /internal/analysis-biomech — WHAM+OpenCap frames → PRD v2.2 result."""
    endpoint = f"{API_SERVER_URL}/internal/analysis-biomech"
    payload = {"analysisId": analysis_id, "pipeline3d": pipeline3d}
    headers = {"Content-Type": "application/json", "X-Internal-Token": INTERNAL_API_SECRET}
    try:
        logger.info("Sending WHAM+OpenCap biomech callback for %s", analysis_id)
        response = requests.post(endpoint, json=payload, headers=headers, timeout=120,
                                 allow_redirects=False)
        if response.status_code == 200:
            logger.info("Biomech callback succeeded for %s", analysis_id)
            return True
        logger.error("Biomech callback failed %d: %s", response.status_code, response.text)
        return False
    except Exception as err:
        logger.error("Biomech callback connection failed for %s: %s", analysis_id, err)
        return False


def notify_analysis_completed(
    analysis_id: str,
    overall_score: int,
    result_json: dict[str, Any],
) -> bool:
    """Send a POST request to the Express API internal callback to report completion.

    Args:
        analysis_id: Unique analysis ID.
        overall_score: Combined technique score.
        result_json: Full biomechanical analysis JSON.

    Returns:
        True if the callback succeeded, False otherwise.
    """
    callback_endpoint = f"{API_SERVER_URL}/internal/analysis-completed"

    payload = {
        "analysisId": analysis_id,
        "status": "completed",
        "overallScore": overall_score,
        "resultJson": result_json,
    }

    headers = {
        "Content-Type": "application/json",
        "X-Internal-Token": INTERNAL_API_SECRET,
    }

    try:
        logger.info(
            "Sending completion callback for analysis %s to %s...",
            analysis_id,
            callback_endpoint,
        )
        response = requests.post(callback_endpoint, json=payload, headers=headers, timeout=10,
                                 allow_redirects=False)
        
        if response.status_code == 200:
            logger.info("Successfully reported analysis completion for %s.", analysis_id)
            return True
        else:
            logger.error(
                "API callback failed with status %d: %s",
                response.status_code,
                response.text,
            )
            return False
    except Exception as err:
        logger.error("Failed to connect to API callback for %s: %s", analysis_id, err)
        return False


def notify_analysis_failed(
    analysis_id: str,
    error_message: str,
) -> bool:
    """Send a POST request to the Express API internal callback to report a failure.

    Args:
        analysis_id: Unique analysis ID.
        error_message: User-facing error message describing why it failed.

    Returns:
        True if the callback succeeded, False otherwise.
    """
    callback_endpoint = f"{API_SERVER_URL}/internal/analysis-completed"

    payload = {
        "analysisId": analysis_id,
        "status": "failed",
        "errorMessage": error_message,
    }

    headers = {
        "Content-Type": "application/json",
        "X-Internal-Token": INTERNAL_API_SECRET,
    }

    try:
        logger.info(
            "Sending failure callback for analysis %s to %s (error: %s)...",
            analysis_id,
            callback_endpoint,
            error_message,
        )
        response = requests.post(callback_endpoint, json=payload, headers=headers, timeout=10,
                                 allow_redirects=False)
        
        if response.status_code == 200:
            logger.info("Successfully reported analysis failure for %s.", analysis_id)
            return True
        else:
            logger.error(
                "API callback failed with status %d: %s",
                response.status_code,
                response.text,
            )
            return False
    except Exception as err:
        logger.error("Failed to connect to API callback for %s: %s", analysis_id, err)
        return False
