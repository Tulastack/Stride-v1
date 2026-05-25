"""MoveNet SinglePose Thunder inference module.

Loads the MoveNet SinglePose Thunder v4 model from TensorFlow Hub and provides
a `process_video` function that runs pose estimation on subsampled video frames.
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MoveNet keypoint ordering (COCO 17-keypoint layout)
# ---------------------------------------------------------------------------
KEYPOINT_NAMES: list[str] = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

KEYPOINT_INDEX: dict[str, int] = {name: idx for idx, name in enumerate(KEYPOINT_NAMES)}

# Minimum average confidence for a frame to be considered usable
CONFIDENCE_THRESHOLD: float = 0.3

# Model version string used in analysis results
MOVENET_VERSION: str = "singlepose-thunder-v4"

# ---------------------------------------------------------------------------
# Model singleton
# ---------------------------------------------------------------------------
_model: Any | None = None


def _load_model() -> Any:
    """Load the MoveNet model from TF Hub (cached after first call)."""
    global _model  # noqa: PLW0603
    if _model is None:
        logger.info("Loading MoveNet SinglePose Thunder v4 from TF Hub …")
        module = hub.load("https://tfhub.dev/google/movenet/singlepose/thunder/4")
        _model = module.signatures["serving_default"]
        logger.info("MoveNet model loaded successfully.")
    return _model


def _run_inference(model: Any, frame: np.ndarray) -> np.ndarray:
    """Run MoveNet on a single BGR frame.

    Args:
        model: The loaded MoveNet serving signature.
        frame: An OpenCV BGR image (HxWx3, uint8).

    Returns:
        A (17, 3) numpy array where each row is [y, x, confidence].
    """
    # MoveNet Thunder expects 256×256 int32
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (256, 256))
    input_tensor = tf.cast(tf.expand_dims(resized, axis=0), dtype=tf.int32)

    outputs = model(input_tensor)
    # output_0 shape: (1, 1, 17, 3)
    keypoints = outputs["output_0"].numpy().squeeze()  # (17, 3)
    return keypoints


def process_video(
    video_path: str,
    target_fps: int = 10,
) -> list[dict[str, Any]]:
    """Run MoveNet inference on subsampled frames from a video file.

    Args:
        video_path: Path to the video file on disk.
        target_fps: Desired frames per second for analysis. Frames are
            subsampled (no interpolation) from the source FPS.

    Returns:
        A list of dicts, one per analysed frame:
            - frame_index (int): 0-based index in the *source* video
            - keypoints (np.ndarray): shape (17, 3) — [y, x, confidence]
            - keypoint_dict (dict): maps keypoint name → [y, x, confidence]
            - avg_confidence (float): mean confidence across 17 keypoints
            - excluded (bool): True if avg_confidence < CONFIDENCE_THRESHOLD

    Raises:
        ValueError: If the video cannot be opened or contains no frames.
    """
    model = _load_model()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video file: {video_path}")

    source_fps: float = cap.get(cv2.CAP_PROP_FPS)
    total_frames: int = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if source_fps <= 0 or total_frames <= 0:
        cap.release()
        raise ValueError(
            f"Invalid video metadata: fps={source_fps}, total_frames={total_frames}"
        )

    # Clamp target_fps to source_fps so we don't try to upsample
    effective_fps = min(target_fps, source_fps)
    frame_interval: float = source_fps / effective_fps

    logger.info(
        "Processing video: %s | source_fps=%.1f, total_frames=%d, target_fps=%d, "
        "frame_interval=%.2f",
        video_path,
        source_fps,
        total_frames,
        target_fps,
        frame_interval,
    )

    results: list[dict[str, Any]] = []
    frame_idx: int = 0
    next_sample: float = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx >= next_sample:
            keypoints = _run_inference(model, frame)
            avg_conf: float = float(np.mean(keypoints[:, 2]))
            excluded: bool = avg_conf < CONFIDENCE_THRESHOLD

            keypoint_dict: dict[str, list[float]] = {
                name: keypoints[idx].tolist()
                for name, idx in KEYPOINT_INDEX.items()
            }

            results.append(
                {
                    "frame_index": frame_idx,
                    "keypoints": keypoints,
                    "keypoint_dict": keypoint_dict,
                    "avg_confidence": round(avg_conf, 4),
                    "excluded": excluded,
                }
            )
            next_sample += frame_interval

        frame_idx += 1

    cap.release()

    if not results:
        raise ValueError("No frames could be read from the video.")

    included = sum(1 for r in results if not r["excluded"])
    excluded = len(results) - included
    logger.info(
        "MoveNet inference complete: %d total frames, %d included, %d excluded (%.1f%% excluded)",
        len(results),
        included,
        excluded,
        (excluded / len(results)) * 100 if results else 0,
    )

    return results
