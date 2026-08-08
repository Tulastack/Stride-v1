"""RTMPose 2D pose backend (YOLOX person detector + RTMPose keypoints).

Open-source, ONNX/CPU-deployable via `rtmlib`. Top-down: detect the athlete,
crop, then estimate keypoints — which is why it survives small/off-centre
subjects that MoveNet SinglePose (no detector) cannot. (The rtmlib `Body`
wrapper ships a YOLOX detector, not RTMDet, for all modes.) Emits the SAME
per-frame contract as movenet.process_video so the rest of the pipeline is
unchanged:

    { frame_index, keypoints (17,3 [y,x,conf] normalized), keypoint_dict,
      avg_confidence, excluded }
"""

from __future__ import annotations

import logging
import os
from typing import Any

import cv2
import numpy as np

from src.crop_tracker import CropTracker
from src.movenet import CORE_JOINTS, KEYPOINT_INDEX, KEYPOINT_NAMES

logger = logging.getLogger(__name__)

# Native keypoint layout this backend emits (rtmlib Body = COCO-17). Declared so
# the pose2d seam can canonicalize it (see canonical_2d / pose_backend).
KEYPOINT_FORMAT = "coco17"

# RTMPose uses SimCC (coordinate-classification) keypoint scores, whose
# distribution is NOT the same shape as MoveNet's heatmap-argmax confidences —
# so it must NOT borrow MoveNet's threshold (that was bug B4). 0.3 is kept as a
# behaviour-preserving starting point; calibrate on running-crop data.
# Override via env RTMPOSE_CONFIDENCE_THRESHOLD.
_CONF_THRESHOLD = float(os.environ.get("RTMPOSE_CONFIDENCE_THRESHOLD", "0.3"))

# Max pixel dimension fed to YOLOX+RTMPose. Frames wider/taller than this are
# downscaled before inference and coordinates are rescaled back — no accuracy
# impact for running gait analysis (joints are large, not fine-detail).
# Override via env RTMPOSE_MAX_DIM (set to 0 to disable).
_MAX_DIM = int(os.environ.get("RTMPOSE_MAX_DIM", "640"))


def _maybe_downscale(frame: np.ndarray) -> tuple[np.ndarray, float]:
    """Downscale frame if its longest dimension exceeds _MAX_DIM.
    Returns (resized_frame, scale) where scale = resized / original.
    scale=1.0 means no resize was done."""
    if _MAX_DIM <= 0:
        return frame, 1.0
    h, w = frame.shape[:2]
    longest = max(h, w)
    if longest <= _MAX_DIM:
        return frame, 1.0
    scale = _MAX_DIM / longest
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR), scale
_LK_PARAMS = dict(
    winSize=(21, 21), maxLevel=2,
    criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
)

_body: Any | None = None


def _load_body(mode: str | None = None) -> Any:
    """Load the rtmlib Body wrapper (YOLOX detector + RTMPose), cached.

    Mode via RTMPOSE_MODE env: 'lightweight' (fastest, RTMPose-t), 'balanced'
    (default), 'performance' (most accurate, GPU-ish). On CPU, 'lightweight' is
    ~2-3x faster."""
    global _body  # noqa: PLW0603
    if _body is None:
        from rtmlib import Body  # imported lazily so movenet-only deploys don't need rtmlib

        mode = mode or os.environ.get("RTMPOSE_MODE", "lightweight")
        logger.info("Loading YOLOX+RTMPose (mode=%s) via rtmlib/onnxruntime …", mode)
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


def _seed_bbox(target) -> tuple[float, float, float, float]:
    """Seed a normalized bbox from a point (x,y) OR an explicit brush bbox
    (x0,y0,x1,y1)."""
    if len(target) == 4:
        x0, y0, x1, y1 = target
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    cx, cy = target
    return (cx - 0.12, cy - 0.30, cx + 0.12, cy + 0.30)  # rough standing-person box


def iter_frames(video_path: str, target_fps: int = 30, target=None, timing_out=None):
    """Streaming generator yielding one lean per-frame dict at a time.

    `target` = the athlete to analyze, as a normalized point (x, y) OR a
    brush-traced bbox (x0, y0, x1, y1). When set, each frame is CROPPED to the
    tracked person's region and pose is run only on that crop — so other people
    are not even in the model's input. This is what stops keypoints jumping to
    bystanders in a multi-person clip. No target → full-frame lock-and-follow.

    `timing_out` (dual-rate): if a list is passed, it is filled at FULL source fps
    with (frame_index, left_ankle_y_norm, right_ankle_y_norm). Between the (sparse)
    pose keyframes the ankle heights are carried by Lucas-Kanade optical flow, so
    cadence / ground-contact get real temporal resolution instead of being capped
    at the 15fps pose rate (see biomech2d._gait_signal). When None, this adds no
    per-frame work and the pose path is unchanged."""
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
    seed = _seed_bbox(target) if target is not None else None  # normalized seed box
    tracker: CropTracker | None = None  # created on the first sampled frame (needs w,h)
    tgt = None  # centroid for the no-target lock-and-follow path
    frame_idx = 0
    next_sample = 0.0
    la, ra = KEYPOINT_INDEX["left_ankle"], KEYPOINT_INDEX["right_ankle"]
    prev_gray = None            # previous frame (grayscale) for LK — timing path only
    ankle_pts = None            # float32 [[Lx,Ly],[Rx,Ry]] full-frame px — LK state
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            h, w = frame.shape[:2]
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if timing_out is not None else None
            if frame_idx >= next_sample:
                kp = np.zeros((17, 3), dtype=float)
                excluded = True

                if seed is not None:
                    # ── crop-to-target: a Kalman + appearance tracker OWNS the
                    #    athlete's identity; pose runs only on the predicted crop ──
                    if tracker is None:
                        tracker = CropTracker(seed, w, h)
                    tracker.predict()
                    sx0, sy0, sx1, sy1 = tracker.search_box()
                    cx0 = max(0, int(sx0 * w)); cy0 = max(0, int(sy0 * h))
                    cx1 = min(w, int(sx1 * w)); cy1 = min(h, int(sy1 * h))
                    # Recovery: once the position lock is stale (long miss run /
                    # exit latch) or the predicted box has drifted degenerate,
                    # search the FULL frame instead of a blind crop — a lost
                    # target must be re-findable anywhere, or every remaining
                    # frame gets excluded and the whole analysis dies.
                    if tracker.needs_global_search() or cx1 - cx0 < 24 or cy1 - cy0 < 24:
                        cx0, cy0, cx1, cy1 = 0, 0, w, h
                    crop = frame[cy0:cy1, cx0:cx1]
                    cw, ch = cx1 - cx0, cy1 - cy0
                    # Downscale crop before inference; coords rescaled back below.
                    crop_inf, crop_scale = _maybe_downscale(crop)
                    kpts_c, scores_c = body(crop_inf)
                    if crop_scale != 1.0 and len(kpts_c) > 0:
                        kpts_c = [xy / crop_scale for xy in kpts_c]
                    idx = tracker.select(kpts_c, scores_c, crop, (cx0, cy0), (cw, ch)) if len(scores_c) > 0 else None
                    if idx is not None:
                        xy, sc = kpts_c[idx], scores_c[idx]
                        kp[:, 0] = np.clip((cy0 + xy[:, 1]) / h, 0, 1)  # y (full-frame)
                        kp[:, 1] = np.clip((cx0 + xy[:, 0]) / w, 0, 1)  # x
                        kp[:, 2] = sc
                        tracker.update(xy, sc, crop, (cx0, cy0), (cw, ch))
                        excluded = float(np.mean(kp[core_idx, 2])) < _CONF_THRESHOLD
                    else:
                        tracker.miss += 1
                else:
                    # ── no target: full-frame lock-and-follow (auto) ──
                    frame_inf, frame_scale = _maybe_downscale(frame)
                    kpts, scores = body(frame_inf)
                    if frame_scale != 1.0 and len(kpts) > 0:
                        kpts = [xy / frame_scale for xy in kpts]
                    best, cent = _select_person(kpts, scores, w, h, tgt, core_idx)
                    if best is not None:
                        tgt = cent
                        xy, sc = kpts[best], scores[best]
                        kp[:, 0] = np.clip(xy[:, 1] / h, 0, 1)
                        kp[:, 1] = np.clip(xy[:, 0] / w, 0, 1)
                        kp[:, 2] = sc
                        excluded = float(np.mean(kp[core_idx, 2])) < _CONF_THRESHOLD

                if timing_out is not None and not excluded:
                    # (re-)anchor the LK ankle points from this fresh pose keyframe
                    ankle_pts = np.array(
                        [[float(kp[la, 1]) * w, float(kp[la, 0]) * h],
                         [float(kp[ra, 1]) * w, float(kp[ra, 0]) * h]], dtype=np.float32)
                    timing_out.append((frame_idx, float(kp[la, 0]), float(kp[ra, 0])))
                yield {
                    "frame_index": frame_idx,
                    "keypoints": kp,
                    "avg_confidence": round(float(np.mean(kp[:, 2])), 4),
                    "excluded": excluded,
                }
                next_sample += interval
            elif timing_out is not None and ankle_pts is not None and prev_gray is not None:
                # between pose keyframes: carry the ankle heights at FULL source fps
                new_pts, _st, _err = cv2.calcOpticalFlowPyrLK(prev_gray, gray, ankle_pts, None, **_LK_PARAMS)
                if new_pts is not None:
                    ankle_pts = new_pts
                    timing_out.append((frame_idx,
                                       float(np.clip(new_pts[0, 1] / h, 0.0, 1.0)),
                                       float(np.clip(new_pts[1, 1] / h, 0.0, 1.0))))
            if timing_out is not None:
                prev_gray = gray
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
