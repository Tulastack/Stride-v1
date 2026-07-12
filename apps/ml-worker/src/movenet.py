"""MoveNet SinglePose Thunder inference module.

Loads the MoveNet SinglePose Thunder v4 model from TensorFlow Hub and provides
a `process_video` function that runs pose estimation on subsampled video frames.
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np
# TensorFlow is imported lazily inside the functions that need it, so modules
# that only use MoveNet's constants (e.g. the RTMPose backend) — or RTMPose-only
# deploys — don't pay the heavy TF import.

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

# Core sprint-relevant joints (shoulders, hips, knees, ankles). We gate frames
# on the mean confidence of THESE joints, not all 17 — face/ear keypoints are
# irrelevant to biomechanics and, on side/running views, drag the 17-kp mean
# below threshold even when the body is tracked well.
CORE_JOINTS: list[str] = [
    "left_shoulder", "right_shoulder", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

# Model version string used in analysis results
MOVENET_VERSION: str = "singlepose-thunder-v4"

# Native keypoint layout this backend emits (COCO-17). Declared so the pose2d
# seam can canonicalize it (see canonical_2d / pose_backend).
KEYPOINT_FORMAT: str = "coco17"

# ---------------------------------------------------------------------------
# Model singleton
# ---------------------------------------------------------------------------
_model: Any | None = None


def _load_model() -> Any:
    """Load the MoveNet model from TF Hub (cached after first call)."""
    global _model  # noqa: PLW0603
    if _model is None:
        import tensorflow_hub as hub  # lazy: only when MoveNet is actually used
        logger.info("Loading MoveNet SinglePose Thunder v4 from TF Hub …")
        module = hub.load("https://tfhub.dev/google/movenet/singlepose/thunder/4")
        _model = module.signatures["serving_default"]
        logger.info("MoveNet model loaded successfully.")
    return _model


def _infer_square(model: Any, square_rgb: np.ndarray) -> np.ndarray:
    """Run MoveNet on an already-square RGB image. Returns (17,3) [y,x,conf]
    in the square image's normalized coordinates."""
    import tensorflow as tf  # lazy: only when MoveNet inference actually runs
    resized = cv2.resize(square_rgb, (256, 256))
    input_tensor = tf.cast(tf.expand_dims(resized, axis=0), dtype=tf.int32)
    outputs = model(input_tensor)
    return outputs["output_0"].numpy().squeeze()  # (17, 3)


def _letterbox(rgb: np.ndarray) -> tuple[np.ndarray, int, int, int]:
    """Pad a HxW RGB image to a centered square WITHOUT distorting aspect ratio.
    MoveNet's own guidance is to keep aspect ratio; a raw resize to 256×256 of a
    720×1280 portrait squashes the runner and destroys keypoint confidence.
    Returns (square_img, offset_y, offset_x, side)."""
    h, w = rgb.shape[:2]
    side = max(h, w)
    oy, ox = (side - h) // 2, (side - w) // 2
    sq = np.zeros((side, side, 3), dtype=rgb.dtype)
    sq[oy:oy + h, ox:ox + w] = rgb
    return sq, oy, ox, side


def _to_original(kp_sq: np.ndarray, oy: int, ox: int, side: int, h: int, w: int) -> np.ndarray:
    """Map (17,3) keypoints from a square-normalized frame back to the ORIGINAL
    frame's normalized [0,1] coordinates, so downstream geometry is unchanged."""
    out = kp_sq.copy()
    out[:, 0] = (kp_sq[:, 0] * side - oy) / h  # y
    out[:, 1] = (kp_sq[:, 1] * side - ox) / w  # x
    return out


def _run_inference(model: Any, frame: np.ndarray) -> np.ndarray:
    """Run MoveNet on a single BGR frame with aspect-preserving letterboxing plus
    a detect→crop→re-infer refinement pass (MoveNet's recommended pattern).

    Returns a (17, 3) numpy array [y, x, confidence] in ORIGINAL-frame normalized
    coordinates.
    """
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # Pass 1: letterboxed full frame.
    sq, oy, ox, side = _letterbox(rgb)
    kp1_sq = _infer_square(model, sq)
    kp1 = _to_original(kp1_sq, oy, ox, side, h, w)

    # Pass 2: crop to the detected person and re-infer for a larger, sharper
    # subject. Only attempt if pass 1 found enough moderately-confident joints.
    good = kp1[:, 2] > 0.15
    if int(good.sum()) < 4:
        return kp1

    ys = np.clip(kp1[good, 0] * h, 0, h)
    xs = np.clip(kp1[good, 1] * w, 0, w)
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    box = max(ys.max() - ys.min(), xs.max() - xs.min()) * 1.3  # 30% margin
    if box < 8:
        return kp1
    y0 = int(max(0, cy - box / 2)); y1 = int(min(h, cy + box / 2))
    x0 = int(max(0, cx - box / 2)); x1 = int(min(w, cx + box / 2))
    crop = rgb[y0:y1, x0:x1]
    if crop.size == 0:
        return kp1

    ch, cw = crop.shape[:2]
    csq, coy, cox, cside = _letterbox(crop)
    kp2_sq = _infer_square(model, csq)
    kp2_crop = _to_original(kp2_sq, coy, cox, cside, ch, cw)  # normalized to crop
    # Map crop-normalized -> original-frame normalized.
    kp2 = kp2_crop.copy()
    kp2[:, 0] = (kp2_crop[:, 0] * ch + y0) / h
    kp2[:, 1] = (kp2_crop[:, 1] * cw + x0) / w

    # Keep pass 2 only if it actually improved core-joint confidence.
    core_idx = [KEYPOINT_INDEX[j] for j in CORE_JOINTS]
    if float(np.mean(kp2[core_idx, 2])) >= float(np.mean(kp1[core_idx, 2])):
        return kp2
    return kp1


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
            # Gate on CORE joints (biomechanically relevant), not the 17-kp mean.
            core_idx = [KEYPOINT_INDEX[j] for j in CORE_JOINTS]
            core_conf: float = float(np.mean(keypoints[core_idx, 2]))
            avg_conf: float = float(np.mean(keypoints[:, 2]))
            excluded: bool = core_conf < CONFIDENCE_THRESHOLD

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
