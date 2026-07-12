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


def _norm_bbox_from_kp(kp: np.ndarray) -> tuple[float, float, float, float] | None:
    """Normalized (x0,y0,x1,y1) enclosing the confident keypoints of a person."""
    good = kp[:, 2] > 0.3
    if int(good.sum()) < 3:
        return None
    xs = kp[good, 1]; ys = kp[good, 0]
    return (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """Intersection-over-union of two normalized (x0,y0,x1,y1) boxes."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    iw = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = iw * ih
    area_a = max(0.0, ax1 - ax0) * max(0.0, ay1 - ay0)
    area_b = max(0.0, bx1 - bx0) * max(0.0, by1 - by0)
    union = area_a + area_b - inter
    return inter / union if union > 1e-9 else 0.0


def _seed_bbox(target) -> tuple[float, float, float, float]:
    """Seed a normalized bbox from a point (x,y) OR an explicit brush bbox
    (x0,y0,x1,y1)."""
    if len(target) == 4:
        x0, y0, x1, y1 = target
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    cx, cy = target
    return (cx - 0.12, cy - 0.30, cx + 0.12, cy + 0.30)  # rough standing-person box


def iter_frames(video_path: str, target_fps: int = 30, target=None):
    """Streaming generator yielding one lean per-frame dict at a time.

    `target` = the athlete to analyze, as a normalized point (x, y) OR a
    brush-traced bbox (x0, y0, x1, y1). When set, each frame is CROPPED to the
    tracked person's region and pose is run only on that crop — so other people
    are not even in the model's input. This is what stops keypoints jumping to
    bystanders in a multi-person clip. No target → full-frame lock-and-follow."""
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
    tbox = _seed_bbox(target) if target is not None else None  # crop-track box (normalized)
    tgt = None  # centroid for the no-target lock-and-follow path
    frame_idx = 0
    next_sample = 0.0
    miss = 0  # consecutive frames the target was lost in the crop
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx >= next_sample:
                h, w = frame.shape[:2]
                kp = np.zeros((17, 3), dtype=float)
                excluded = True

                if tbox is not None:
                    # ── crop-to-target: run pose ONLY on the tracked region ──
                    x0, y0, x1, y1 = tbox
                    mx = (x1 - x0) * (0.4 + 0.25 * miss) + 0.04  # widen search if recently lost
                    my = (y1 - y0) * (0.25 + 0.2 * miss) + 0.04
                    cx0 = max(0, int((x0 - mx) * w)); cy0 = max(0, int((y0 - my) * h))
                    cx1 = min(w, int((x1 + mx) * w)); cy1 = min(h, int((y1 + my) * h))
                    if cx1 - cx0 >= 24 and cy1 - cy0 >= 24:
                        crop = frame[cy0:cy1, cx0:cx1]
                        kpts_c, scores_c = body(crop)
                        if len(scores_c) > 0:
                            # Match against the box we ACTUALLY tracked last frame (IoU),
                            # not just whichever detection is nearest the crop centre —
                            # centre-proximity alone picks the wrong runner whenever a
                            # bystander drifts toward the middle of the (re-centred) crop.
                            best_kp, best_bbox, best_score = None, None, -1.0
                            for xy, sc in zip(kpts_c, scores_c):
                                cand = np.zeros((17, 3), dtype=float)
                                cand[:, 0] = np.clip((cy0 + xy[:, 1]) / h, 0, 1)  # y (full-frame)
                                cand[:, 1] = np.clip((cx0 + xy[:, 0]) / w, 0, 1)  # x
                                cand[:, 2] = sc
                                cand_bbox = _norm_bbox_from_kp(cand)
                                if cand_bbox is None:
                                    continue
                                # Overlap with the prior tracked box matters far more than
                                # raw detection confidence — a confident bystander should
                                # still lose to a lower-confidence read of the real target.
                                score = _iou(cand_bbox, tbox) + 0.1 * float(np.mean(sc[core_idx]))
                                if score > best_score:
                                    best_kp, best_bbox, best_score = cand, cand_bbox, score
                            if best_kp is not None and _iou(best_bbox, tbox) > 0.05:
                                kp = best_kp
                                # EMA the tracked box toward the new detection
                                tbox = tuple(0.5 * o + 0.5 * n for o, n in zip(tbox, best_bbox))
                                miss = 0
                                excluded = float(np.mean(kp[core_idx, 2])) < CONFIDENCE_THRESHOLD
                            else:
                                miss += 1
                        else:
                            miss += 1
                    else:
                        miss += 1
                else:
                    # ── no target: full-frame lock-and-follow (auto) ──
                    kpts, scores = body(frame)
                    best, cent = _select_person(kpts, scores, w, h, tgt, core_idx)
                    if best is not None:
                        tgt = cent
                        xy, sc = kpts[best], scores[best]
                        kp[:, 0] = np.clip(xy[:, 1] / h, 0, 1)
                        kp[:, 1] = np.clip(xy[:, 0] / w, 0, 1)
                        kp[:, 2] = sc
                        excluded = float(np.mean(kp[core_idx, 2])) < CONFIDENCE_THRESHOLD

                yield {
                    "frame_index": frame_idx,
                    "keypoints": kp,
                    "avg_confidence": round(float(np.mean(kp[:, 2])), 4),
                    "excluded": excluded,
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
