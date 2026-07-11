"""RTMPose 2D pose backend (RTMDet person detector + RTMPose keypoints).

Open-source, ONNX/CPU-deployable via `rtmlib`. Top-down: detect the athlete,
crop, then estimate keypoints — which is why it survives small/off-centre
subjects that MoveNet SinglePose (no detector) cannot. Emits the SAME per-frame
contract as movenet.process_video so the rest of the pipeline is unchanged:

    { frame_index, keypoints (17,3 [y,x,conf] normalized), keypoint_dict,
      avg_confidence, excluded }
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np

from src.movenet import CONFIDENCE_THRESHOLD, CORE_JOINTS, KEYPOINT_INDEX, KEYPOINT_NAMES

logger = logging.getLogger(__name__)

_body: Any | None = None


def _load_body(mode: str | None = None) -> Any:
    """Load the rtmlib Body wrapper (RTMDet + RTMPose), cached.

    Mode via RTMPOSE_MODE env: 'lightweight' (fastest, RTMPose-t), 'balanced'
    (default), 'performance' (most accurate, GPU-ish). On CPU, 'lightweight' is
    ~2-3x faster."""
    global _body  # noqa: PLW0603
    if _body is None:
        import os
        from rtmlib import Body  # imported lazily so movenet-only deploys don't need rtmlib

        mode = mode or os.environ.get("RTMPOSE_MODE", "balanced")
        logger.info("Loading RTMDet+RTMPose (mode=%s) via rtmlib/onnxruntime …", mode)
        _body = Body(mode=mode, backend="onnxruntime", device="cpu")
        logger.info("RTMPose backend loaded.")
    return _body


# Torso keypoints define a stable person centroid (for target association).
_TORSO = [5, 6, 11, 12]
# Max normalized distance a tracked target may jump between sampled frames before
# we treat it as "target not in frame" (occluded / left).
_TRACK_GATE = 0.20


def _person_centroids(kpts: np.ndarray, w: int, h: int) -> list[tuple[float, float]]:
    """Normalized (x, y) torso centroid for each detected person."""
    out = []
    for xy in kpts:
        out.append((float(np.mean(xy[_TORSO, 0])) / w, float(np.mean(xy[_TORSO, 1])) / h))
    return out


def _select_person(kpts, scores, w, h, target, core_idx):
    """Return (index, centroid). Without a target: highest-confidence person.
    With a target (running normalized x,y): the nearest person within the gate.
    Uses both distance AND confidence to prefer the tracked person over noise."""
    if len(scores) == 0:
        return None, target
    cents = _person_centroids(kpts, w, h)
    if target is None:
        best = int(np.argmax([np.mean(s[core_idx]) for s in scores]))
        return best, cents[best]
    # Score each detection: lower distance = better, higher confidence = better
    dists = [((c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2) ** 0.5 for c in cents]
    confs = [float(np.mean(s[core_idx])) for s in scores]
    # Combined score: distance penalty + confidence bonus (distance matters more)
    combined = [d - 0.1 * conf for d, conf in zip(dists, confs)]
    best = int(np.argmin(combined))
    if dists[best] > _TRACK_GATE:
        return None, target  # target not near any detection this frame
    return best, cents[best]


def iter_frames(video_path: str, target_fps: int = 30, target: tuple[float, float] | None = None):
    """Streaming generator: yields ONE lean per-frame dict at a time
    (frame_index, keypoints, avg_confidence, excluded) — no keypoint_dict, and
    only the current frame is ever held in memory. Use this for the 2D path.

    `target` = the user-selected normalized (x, y) of the athlete to analyze.
    When set, the SAME person is tracked across frames (nearest-centroid, gated),
    so a multi-person clip focuses on the intended runner instead of whoever has
    the cleanest keypoints."""
    body = _load_body()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video file: {video_path}")

    source_fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if source_fps <= 0 or total <= 0:
        cap.release()
        raise ValueError(f"Invalid video metadata: fps={source_fps}, total_frames={total}")

    effective_fps = min(target_fps, source_fps)
    interval = source_fps / effective_fps
    core_idx = [KEYPOINT_INDEX[j] for j in CORE_JOINTS]
    tgt = tuple(target) if target is not None else None
    frame_idx = 0
    next_sample = 0.0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx >= next_sample:
                h, w = frame.shape[:2]
                kpts, scores = body(frame)  # kpts (N,17,2) pixel xy, scores (N,17)
                best, cent = _select_person(kpts, scores, w, h, tgt, core_idx)
                if best is None:
                    kp = np.zeros((17, 3), dtype=float)  # excluded (target absent this frame)
                else:
                    # Lock-and-follow: the FIRST accepted person becomes the tracked
                    # target (user-selected, or the clearest one in auto mode); every
                    # later frame follows THAT person's centroid — never re-picks a
                    # different person by confidence. This is what keeps a multi-person
                    # clip focused on a single athlete instead of flickering between them.
                    tgt = cent
                    xy, sc = kpts[best], scores[best]
                    kp = np.zeros((17, 3), dtype=float)
                    kp[:, 0] = np.clip(xy[:, 1] / h, 0, 1)
                    kp[:, 1] = np.clip(xy[:, 0] / w, 0, 1)
                    kp[:, 2] = sc
                core_conf = float(np.mean(kp[core_idx, 2]))
                yield {
                    "frame_index": frame_idx,
                    "keypoints": kp,
                    "avg_confidence": round(float(np.mean(kp[:, 2])), 4),
                    "excluded": best is None or core_conf < CONFIDENCE_THRESHOLD,
                }
                next_sample += interval
            frame_idx += 1
    finally:
        cap.release()


def process_video(video_path: str, target_fps: int = 30) -> list[dict[str, Any]]:
    """List variant (adds keypoint_dict for the WHAM path). Same contract as movenet."""
    results = []
    for f in iter_frames(video_path, target_fps):
        kp = f["keypoints"]
        f["keypoint_dict"] = {name: kp[i].tolist() for name, i in KEYPOINT_INDEX.items()}
        results.append(f)
    if not results:
        raise ValueError("No frames could be read from the video.")
    incl = sum(1 for r in results if not r["excluded"])
    logger.info("RTMPose complete: %d frames, %d included, %d excluded", len(results), incl, len(results) - incl)
    return results
