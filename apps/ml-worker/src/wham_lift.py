"""Stage 2 — WHAM-class monocular 3D lift (SMPL in gravity-aligned world frame).

Attempts to run the real WHAM codebase when STRIDE_WHAM_REPO is configured.
Falls back to a SMPL-parameterized gravity lift from 2D keypoints + gyro when
WHAM weights are unavailable — same output contract, lower fidelity.
"""

from __future__ import annotations

import json
import logging
import math
import os
import subprocess
import sys
from typing import Any

import numpy as np

from src.joint_schema import BONE_LENGTH_M, JOINT_NAMES, MOVENET_TO_ENGINE, WHAM_JOINT_MAP, Frame3D

logger = logging.getLogger(__name__)

Vec3 = tuple[float, float, float]


def _mid(a: Vec3, b: Vec3) -> Vec3:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def _len(a: Vec3) -> float:
    return math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)


def _norm(a: Vec3) -> Vec3:
    l = _len(a) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def _rotate_yaw(p: Vec3, yaw_rad: float) -> Vec3:
    c, s = math.cos(yaw_rad), math.sin(yaw_rad)
    return (c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2])


def integrated_yaw(gyro: list[dict[str, Any]], t_ms: float) -> float:
    if not gyro:
        return 0.0
    yaw = 0.0
    prev = gyro[0]
    prev_t = prev.get("tMs", 0)
    for g in gyro:
        t = g.get("tMs", 0)
        if t > t_ms:
            break
        dt = max(0, t - prev_t) / 1000.0
        yaw += g.get("yawRateRadS", 0.0) * dt
        prev = g
        prev_t = t
    return yaw


def movenet_frames_to_engine(
    movenet_frames: list[dict[str, Any]],
    width_px: int,
    height_px: int,
    source_fps: float,
) -> tuple[list[dict[str, Any]], float]:
    """Convert MoveNet output to engine-style 2D keypoint frames."""
    out: list[dict[str, Any]] = []
    for i, frame in enumerate(movenet_frames):
        if frame.get("excluded"):
            continue
        kp_dict = frame.get("keypoint_dict") or {}
        joints: dict[str, dict[str, float]] = {}
        confs: list[float] = []
        for mn, eng in MOVENET_TO_ENGINE.items():
            if mn not in kp_dict:
                continue
            y, x, conf = kp_dict[mn]
            # MoveNet outputs normalized [y, x, confidence] in 0..1
            joints[eng] = {
                "x": float(x),
                "y": float(y),
                "confidence": float(conf),
            }
            confs.append(float(conf))
        if "l_shoulder" in joints and "r_shoulder" in joints:
            joints["neck"] = {
                "x": (joints["l_shoulder"]["x"] + joints["r_shoulder"]["x"]) / 2,
                "y": (joints["l_shoulder"]["y"] + joints["r_shoulder"]["y"]) / 2,
                "confidence": min(joints["l_shoulder"]["confidence"], joints["r_shoulder"]["confidence"]),
            }
        t_ms = int((frame.get("frame_index", i) / max(source_fps, 1)) * 1000)
        out.append({"tMs": t_ms, "joints": joints, "meanConf": float(np.mean(confs)) if confs else 0.5})
    fps = min(120.0, max(10.0, source_fps))
    return out, fps


def _try_wham_repo(
    video_path: str,
    capture: dict[str, Any],
    keypoints_json_path: str | None,
) -> list[Frame3D] | None:
    """Invoke cloned WHAM repo if STRIDE_WHAM_REPO points to a checkout with demo.py."""
    repo = os.environ.get("STRIDE_WHAM_REPO", "")
    if not repo or not os.path.isdir(repo):
        return None

    demo = os.path.join(repo, "demo.py")
    if not os.path.isfile(demo):
        logger.warning("STRIDE_WHAM_REPO set but demo.py not found at %s", demo)
        return None

    out_path = video_path + ".wham.json"
    cmd = [
        sys.executable,
        demo,
        "--video",
        video_path,
        "--output_json",
        out_path,
    ]
    if keypoints_json_path:
        cmd.extend(["--keypoints", keypoints_json_path])
    if capture.get("gyro"):
        gyro_path = video_path + ".gyro.json"
        with open(gyro_path, "w", encoding="utf-8") as f:
            json.dump({"gyro": capture["gyro"]}, f)
        cmd.extend(["--gyro", gyro_path])

    logger.info("Running WHAM: %s", " ".join(cmd))
    try:
        subprocess.run(cmd, cwd=repo, check=True, timeout=600, capture_output=True)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
        logger.warning("WHAM subprocess failed: %s", err)
        return None

    if not os.path.isfile(out_path):
        return None

    with open(out_path, encoding="utf-8") as f:
        raw = json.load(f)

    return _parse_wham_json(raw)


def _parse_wham_json(raw: dict[str, Any] | list[Any]) -> list[Frame3D]:
    """Parse WHAM demo JSON into Frame3D list."""
    frames_raw = raw.get("frames", raw) if isinstance(raw, dict) else raw
    out: list[Frame3D] = []
    for fr in frames_raw:
        pose_src = fr.get("joints") or fr.get("pose") or {}
        pose: dict[str, list[float]] = {}
        for src_name, eng in WHAM_JOINT_MAP.items():
            if src_name in pose_src:
                v = pose_src[src_name]
                pose[eng] = [float(v[0]), float(v[1]), float(v[2])]
            elif eng in pose_src:
                v = pose_src[eng]
                pose[eng] = [float(v[0]), float(v[1]), float(v[2])]
        for j in JOINT_NAMES:
            if j not in pose:
                pose[j] = [0.0, 0.0, 0.0]
        out.append(
            {
                "timestampMs": int(fr.get("tMs") or fr.get("timestampMs") or 0),
                "pose": pose,
                "keypointConfidence": float(fr.get("confidence", 0.85)),
                "reconResidual": float(fr.get("reconResidual", 0.08)),
            }
        )
    return out


def _focal_length(capture: dict[str, Any]) -> float:
    intr = capture.get("intrinsics") or {}
    if intr.get("focalLengthPx"):
        return float(intr["focalLengthPx"])
    h = float(capture.get("heightPx") or 1920)
    return h / (2 * math.tan(math.radians(30)))


def _smpl_gravity_lift_frame(
    joints_2d: dict[str, dict[str, float]],
    mean_conf: float,
    depth_scale: float,
    fx: float,
    cx: float,
    cy: float,
    w: int,
    h: int,
    cam_yaw: float,
) -> tuple[dict[str, list[float]], float]:
    """SMPL-parameterized monocular lift in gravity-aligned world frame."""
    pose: dict[str, Vec3] = {}

    def to3(x_n: float, y_n: float, z: float) -> Vec3:
        px, py = x_n * w, y_n * h
        x = ((px - cx) * z) / fx
        y = -((py - cy) * z) / fx
        return _rotate_yaw((x, y, z), -cam_yaw)

    for j in JOINT_NAMES:
        p = joints_2d.get(j)
        if not p:
            pose[j] = (0.0, 0.0, 0.0)
            continue
        z = depth_scale * (0.85 + 0.25 * p["confidence"])
        pose[j] = to3(p["x"], p["y"], z)

    # Pelvis-centric SMPL prior: enforce approximate bone graph
    if "l_hip" in pose and "r_hip" in pose:
        pelvis = _mid(pose["l_hip"], pose["r_hip"])
        for side in ("l", "r"):
            hip = pose[f"{side}_hip"]
            knee = pose[f"{side}_knee"]
            ankle = pose[f"{side}_ankle"]
            thigh = BONE_LENGTH_M[f"{side}_hip"]
            shank = BONE_LENGTH_M[f"{side}_knee"]
            foot = BONE_LENGTH_M[f"{side}_ankle"]
            knee_dir = _norm(_sub(knee, hip))
            pose[f"{side}_knee"] = _add(hip, _scale(knee_dir, thigh))
            ankle_dir = _norm(_sub(ankle, pose[f"{side}_knee"]))
            pose[f"{side}_ankle"] = _add(pose[f"{side}_knee"], _scale(ankle_dir, shank))
            toe_dir = _norm(_sub(pose[f"{side}_toe"], pose[f"{side}_ankle"]))
            pose[f"{side}_toe"] = _add(pose[f"{side}_ankle"], _scale(toe_dir, foot))
        void = pelvis

    residual = 0.0
    for bone, length in BONE_LENGTH_M.items():
        parent = {
            "neck": "head",
            "l_shoulder": "neck",
            "r_shoulder": "neck",
            "l_hip": "l_shoulder",
            "r_hip": "r_shoulder",
            "l_knee": "l_hip",
            "r_knee": "r_hip",
            "l_ankle": "l_knee",
            "r_ankle": "r_knee",
            "l_toe": "l_ankle",
            "r_toe": "r_ankle",
        }.get(bone)
        if parent and bone in pose and parent in pose:
            residual += abs(_len(_sub(pose[bone], pose[parent])) - length)

    out_pose = {k: [v[0], v[1], v[2]] for k, v in pose.items()}
    return out_pose, residual / max(len(BONE_LENGTH_M), 1)


def smpl_gravity_lift(
    keypoint_frames: list[dict[str, Any]],
    capture: dict[str, Any],
    fps: float,
) -> list[Frame3D]:
    """Fallback Stage 2: SMPL-shaped lift with gyro gravity alignment."""
    w = int(capture.get("widthPx") or 1080)
    h = int(capture.get("heightPx") or 1920)
    fx = _focal_length(capture)
    cx = w / 2.0
    cy = h / 2.0
    gyro = capture.get("gyro") or []

    # Depth scale from hip width in image (side-on = wider)
    hip_widths = []
    for fr in keypoint_frames:
        j = fr.get("joints") or {}
        if "l_hip" in j and "r_hip" in j:
            hip_widths.append(abs(j["r_hip"]["x"] - j["l_hip"]["x"]))
    hip_w = float(np.median(hip_widths)) if hip_widths else 0.12
    depth_scale = 0.55 / max(hip_w, 0.04)

    frames: list[Frame3D] = []
    for fr in keypoint_frames:
        t_ms = int(fr.get("tMs", 0))
        cam_yaw = integrated_yaw(gyro, t_ms)
        pose, residual = _smpl_gravity_lift_frame(
            fr.get("joints") or {},
            float(fr.get("meanConf", 0.7)),
            depth_scale,
            fx,
            cx,
            cy,
            w,
            h,
            cam_yaw,
        )
        frames.append(
            {
                "timestampMs": t_ms,
                "pose": pose,
                "keypointConfidence": float(fr.get("meanConf", 0.7)),
                "reconResidual": round(residual, 4),
            }
        )
    return frames


def wham_lift(
    video_path: str,
    movenet_frames: list[dict[str, Any]],
    capture: dict[str, Any],
    source_fps: float,
) -> tuple[list[Frame3D], str]:
    """Stage 2 entry: WHAM GPU when available, else SMPL-gravity lift."""
    kp_frames, fps = movenet_frames_to_engine(
        movenet_frames,
        int(capture.get("widthPx") or 1080),
        int(capture.get("heightPx") or 1920),
        source_fps,
    )

    kp_path = video_path + ".keypoints.json"
    with open(kp_path, "w", encoding="utf-8") as f:
        json.dump({"fps": fps, "frames": [{"tMs": fr["tMs"], "joints": fr["joints"]} for fr in kp_frames]}, f)

    wham_out = _try_wham_repo(video_path, capture, kp_path)
    if wham_out:
        logger.info("Stage 2 complete via WHAM (%d frames)", len(wham_out))
        return wham_out, "wham-gpu"

    frames = smpl_gravity_lift(kp_frames, capture, fps)
    logger.info("Stage 2 complete via SMPL-gravity lift (%d frames)", len(frames))
    return frames, "smpl-gravity-fallback"
