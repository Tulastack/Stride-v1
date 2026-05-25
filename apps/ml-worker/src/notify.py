"""Notification client for reporting analysis results to the Express API server."""

from __future__ import annotations

import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)


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
    api_url = os.environ.get("API_SERVER_URL", "http://localhost:3000")
    callback_endpoint = f"{api_url}/internal/analysis-completed"
    secret_token = os.environ.get("INTERNAL_API_SECRET", "")

    payload = {
        "analysisId": analysis_id,
        "status": "completed",
        "overallScore": overall_score,
        "resultJson": result_json,
    }

    headers = {
        "Content-Type": "application/json",
        "X-Internal-Token": secret_token,
    }

    try:
        logger.info(
            "Sending completion callback for analysis %s to %s...",
            analysis_id,
            callback_endpoint,
        )
        response = requests.post(callback_endpoint, json=payload, headers=headers, timeout=10)
        
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
    api_url = os.environ.get("API_SERVER_URL", "http://localhost:3000")
    callback_endpoint = f"{api_url}/internal/analysis-completed"
    secret_token = os.environ.get("INTERNAL_API_SECRET", "")

    payload = {
        "analysisId": analysis_id,
        "status": "failed",
        "errorMessage": error_message,
    }

    headers = {
        "Content-Type": "application/json",
        "X-Internal-Token": secret_token,
    }

    try:
        logger.info(
            "Sending failure callback for analysis %s to %s (error: %s)...",
            analysis_id,
            callback_endpoint,
            error_message,
        )
        response = requests.post(callback_endpoint, json=payload, headers=headers, timeout=10)
        
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
