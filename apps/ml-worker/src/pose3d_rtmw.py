"""RTMW3D image-to-3D pose backend.

WHAT THIS IS
------------
RTMW3D predicts 3D joint locations directly from pixels. It is NOT a 2D->3D
lifter bolted onto RTMPose: it replaces 2D pose estimation and the lift with one
network, emitting 133 COCO-WholeBody joints whose first 17 are exactly the
COCO-17 body set the rest of this pipeline already speaks.

That distinction matters for how its output should be read. A geometric lift
(src/lift3d.py) recovers depth from bone-length constraints -- it is solving,
and when the view does not contain the information the solve degrades in ways
you can watch. A learned model INFERS depth from what running looked like in its
training data. Where the camera saw the sagittal plane the two agree; where it
did not, the geometric method degrades and the learned one confabulates
plausibly. Plausible confabulation is more dangerous than visible degradation,
because it does not announce itself.

Concretely: if the prior encodes how people run, a depth estimate drawn from
that prior cannot then be used to certify how THIS athlete deviates from how
people run. The reasoning is circular in the direction that matters. So the
observability gate in analyze3d applies to this backend exactly as it does to
the geometric one -- arguably harder.

COORDINATE SPACE
----------------
rtmlib's RTMPose3d returns three things and only one of them is metrically
coherent:

  keypoints       x,y in model-input pixels but z rescaled to +/-z_range.
                  MIXED UNITS -- angles computed from this are meaningless.
  keypoints_2d    x,y rescaled to the original image. No depth.
  keypoints_simcc x,y,z all in the same 288x384x384 voxel space.  <-- use this

We use keypoints_simcc. The crop is aspect-preserved into 288x384, so x and y
are isotropic, and the depth axis spans the same 384 range as height, which is
the model's own convention for depth extent.

The output is also RE-ANCHORED into image space. SimCC coordinates are relative
to a per-frame crop, so the athlete sits at roughly the same place in every
frame and global translation is destroyed. Two things downstream need it:
vertical oscillation is hip-height RANGE, and heading is estimated from pelvis
travel. Left un-anchored, oscillation read 57% against a 4-11% band. rtmlib
already returns `keypoints_2d` mapped back to image pixels, so x and y are taken
from there and z is scaled by the same crop-to-image factor, recovered per frame
from the ratio of an image-space span to its crop-space counterpart.

The y axis is then NEGATED. SimCC y follows the image convention and increases
DOWNWARD, while the canonical-frame builder expects a right-handed frame with +Y
up. Feeding it un-flipped inverts the skeleton, and the failure is quiet rather
than loud: bone lengths stay correct, the solve looks healthy, and the metrics
come out as trunk lean 176 deg and knee drive 179 deg -- an athlete measured
upside down. Verified against real footage before and after.

LICENCE
-------
Weights are NOT redistributable until provenance is cleared. The model card
declares Apache-2.0, but RTMW3D's 3D training mix is believed to include H3WB,
derived from Human3.6M, which is academic/non-commercial. That restriction
travels with weights, not code. .models/ is gitignored for this reason.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np

from src.canonical_2d import CANON_KP as KP, NUM_CANON

logger = logging.getLogger(__name__)

MODEL_DIR = os.environ.get("STRIDE_MODEL_DIR", ".models")
POSE_ONNX = os.path.join(MODEL_DIR, "rtmw3d-x.onnx")
DET_ONNX = os.path.join(
    MODEL_DIR, "yolox_m/20230928/yolox_onnx/"
    "yolox_m_8xb8-300e_humanart-c2c7a14a/end2end.onnx")
INPUT_SIZE = (288, 384)

# COCO-WholeBody's first 17 joints ARE COCO-17, in the same order, so the
# mapping is the identity slice. Asserted in tests rather than assumed.
BODY17 = slice(0, 17)

# Anatomical segment ratios against torso length (shoulder-midpoint to
# hip-midpoint). Used ONLY to score reconstruction consistency, never to correct
# the pose -- correcting toward a prior would hide the very error we want to see.
SEGMENT_RATIO = {"thigh": 0.87, "shank": 0.83, "upperarm": 0.58, "forearm": 0.50}
_SEGMENTS = (
    ("thigh", "left_hip", "left_knee"), ("thigh", "right_hip", "right_knee"),
    ("shank", "left_knee", "left_ankle"), ("shank", "right_knee", "right_ankle"),
    ("upperarm", "left_shoulder", "left_elbow"),
    ("forearm", "left_elbow", "left_wrist"),
)

_pose_model = None
_det_model = None


def _load():
    """Lazy load, mirroring rtmpose_backend._load_body so threading, backend
    selection and the Dockerfile need no special-casing for this path."""
    global _pose_model, _det_model
    if _pose_model is None:
        from rtmlib import RTMPose3d, YOLOX
        if not os.path.isfile(POSE_ONNX):
            raise ValueError("rtmw3d_model_missing")
        _det_model = YOLOX(DET_ONNX, model_input_size=(640, 640),
                           backend="onnxruntime", device="cpu")
        _pose_model = RTMPose3d(POSE_ONNX, model_input_size=INPUT_SIZE,
                                backend="onnxruntime", device="cpu")
        logger.info("RTMW3D loaded from %s", POSE_ONNX)
    return _det_model, _pose_model


def segment_consistency(poses: np.ndarray) -> dict[str, float]:
    """How stable the recovered skeleton's proportions are across the clip.

    A correct reconstruction has rigid bones: thigh/torso is one number for one
    athlete, every frame. Drift in that ratio is reconstruction error that has
    nowhere to hide, and unlike a bone-closure residual it cannot be satisfied
    by a wrong-but-self-consistent solve.

    Returns the mean coefficient of variation across segments, and the mean
    absolute deviation of each segment's median ratio from anatomy. Both are
    measured, neither is assumed.
    """
    ratios: dict[str, list[float]] = {k: [] for k in SEGMENT_RATIO}
    for P in poses:
        need = [KP["left_shoulder"], KP["right_shoulder"], KP["left_hip"], KP["right_hip"]]
        if not np.isfinite(P[need]).all():
            continue
        ms = (P[KP["left_shoulder"]] + P[KP["right_shoulder"]]) / 2
        mh = (P[KP["left_hip"]] + P[KP["right_hip"]]) / 2
        torso = float(np.linalg.norm(ms - mh))
        if torso < 1e-6:
            continue
        for lab, a, b in _SEGMENTS:
            if np.isfinite(P[KP[a]]).all() and np.isfinite(P[KP[b]]).all():
                ratios[lab].append(float(np.linalg.norm(P[KP[b]] - P[KP[a]])) / torso)
    cvs, devs = [], []
    for lab, vals in ratios.items():
        if len(vals) < 5:
            continue
        v = np.asarray(vals)
        med = float(np.median(v))
        cvs.append(float(np.std(v) / max(med, 1e-6)))
        devs.append(abs(med - SEGMENT_RATIO[lab]) / SEGMENT_RATIO[lab])
    return {
        "segmentCV": round(float(np.mean(cvs)), 4) if cvs else float("nan"),
        "segmentBias": round(float(np.mean(devs)), 4) if devs else float("nan"),
        "nSegments": len(cvs),
    }


def extract_3d_sequence(video_path: str, target=None, target_fps: int = 15,
                        max_frames: int = 300) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Run RTMW3D over a clip, returning COCO-17 3D poses in the simcc space.

    `target` is the athlete the user brushed, in the same normalized form the
    2D path accepts. Identity is held by the existing CropTracker: without it a
    multi-person track clip lets the pose jump between athletes between frames,
    and no downstream trust gate can detect that.
    """
    import cv2
    from src.crop_tracker import CropTracker

    det, pose = _load()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video file: {video_path}")
    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1.0, src_fps / float(min(target_fps, src_fps)))

    poses, confs, idxs = [], [], []
    prev_box = None
    dropped = 0
    frame_i, next_sample, kept = 0, 0.0, 0
    try:
        while kept < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_i >= next_sample:
                next_sample += step
                boxes = det(frame)
                box = _pick_box(boxes, prev_box, target, w, h)
                if box is None:
                    dropped += 1
                else:
                    prev_box = box
                    k3, sc, simcc, k2 = pose(frame, bboxes=[box])
                    P = np.asarray(simcc)[0][BODY17].copy()
                    I = np.asarray(k2)[0][BODY17]          # image-space x, y
                    s = np.asarray(sc)[0][BODY17]
                    kp = np.full((NUM_CANON, 3), np.nan)
                    cf = np.zeros(NUM_CANON)
                    keep = s >= 0.3
                    k = _crop_to_image_scale(P, I)
                    if k is None:
                        frame_i += 1
                        continue
                    world = np.empty_like(P)
                    world[:, 0] = I[:, 0]                  # image x
                    world[:, 1] = -I[:, 1]                 # image y is down; +Y up
                    world[:, 2] = P[:, 2] * k              # depth, same units
                    kp[:17][keep] = world[keep]
                    cf[:17][keep] = s[keep]
                    poses.append(kp)
                    confs.append(cf)
                    idxs.append(frame_i)
                    kept += 1
            frame_i += 1
    finally:
        cap.release()

    if len(poses) < 8:
        raise ValueError("low_confidence_video")
    poses = np.asarray(poses)
    confs = np.asarray(confs)
    meta = {
        "backend": "rtmw3d-x",
        "poseFps": float(min(target_fps, src_fps)),
        "sourceFps": src_fps,
        "frames": len(poses),
        "frameIndices": idxs,
        "meanConfidence": round(float(np.mean(confs[confs > 0])), 4) if (confs > 0).any() else 0.0,
        "droppedFrames": dropped,
        **segment_consistency(poses),
    }
    return poses, confs, meta


def _crop_to_image_scale(crop_xy: np.ndarray, image_xy: np.ndarray) -> float | None:
    """Pixels-per-crop-unit for this frame, so depth shares the units of x and y.

    Derived from the data rather than assumed: take the widest well-separated
    joint pair and compare its span in image space against the same span in crop
    space. Using the widest pair keeps the ratio away from the noise floor.
    """
    best, k = 0.0, None
    n = len(crop_xy)
    for i in range(n):
        for j in range(i + 1, n):
            dc = float(np.linalg.norm(crop_xy[j, :2] - crop_xy[i, :2]))
            if dc <= best or dc < 1e-6:
                continue
            di = float(np.linalg.norm(image_xy[j] - image_xy[i]))
            if di < 1e-6:
                continue
            best, k = dc, di / dc
    return k


MAX_BOX_JUMP = 0.18     # fraction of frame width a box may move between samples


def _pick_box(boxes, prev, target, w, h):
    """Hold one athlete's identity across frames.

    Largest-box selection is not good enough on real footage: a track clip has
    coaches and team-mates in shot, and picking the biggest box independently
    each frame silently swaps athletes. The swap is invisible in the joint
    angles -- both people have plausible knees -- but it wrecks anything built
    on position continuity. Measured on IMG_0271 it drove vertical oscillation
    to 83% against a 0-20% envelope and pelvic drop to 73 deg against 0-45.

    Seeded by the athlete the user brushed when there is one, then carried
    forward by nearest-centre with a motion gate. Lighter than the Kalman +
    appearance CropTracker on the 2D path; the gate is what stops a swap.
    """
    if boxes is None or len(boxes) == 0:
        return None
    cen = lambda b: ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)

    if prev is None:
        if target:
            tx = target.get("xNorm")
            if tx is None and target.get("x0") is not None:
                tx = (float(target["x0"]) + float(target["x1"])) / 2.0
                ty = (float(target["y0"]) + float(target["y1"])) / 2.0
            else:
                ty = target.get("yNorm")
            if tx is not None and ty is not None:
                px, py = float(tx) * w, float(ty) * h
                return min(boxes, key=lambda b: (cen(b)[0] - px) ** 2 + (cen(b)[1] - py) ** 2)
        return max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))

    pcx, pcy = cen(prev)
    gate = MAX_BOX_JUMP * w
    cand = [b for b in boxes
            if abs(cen(b)[0] - pcx) < gate and abs(cen(b)[1] - pcy) < gate * (h / max(w, 1))]
    if not cand:
        return None          # lost: drop the frame rather than lock a stranger
    return min(cand, key=lambda b: (cen(b)[0] - pcx) ** 2 + (cen(b)[1] - pcy) ** 2)
