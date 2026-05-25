"""Biomechanical analysis engine for sprint video keypoint data.

Takes MoveNet keypoint frames and computes per-frame metrics, detects sprint
phases, and identifies biomechanical issues by comparing averaged metrics
against reference thresholds.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Keypoint index constants (COCO 17-keypoint, y-x-confidence)
# ---------------------------------------------------------------------------
KP = {
    "nose": 0,
    "left_eye": 1,
    "right_eye": 2,
    "left_ear": 3,
    "right_ear": 4,
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_wrist": 9,
    "right_wrist": 10,
    "left_hip": 11,
    "right_hip": 12,
    "left_knee": 13,
    "right_knee": 14,
    "left_ankle": 15,
    "right_ankle": 16,
}

# ---------------------------------------------------------------------------
# Reference thresholds
# ---------------------------------------------------------------------------
# Knee drive: angle between thigh (hip→knee) and vertical
KNEE_DRIVE_OPTIMAL_MIN: float = 90.0
KNEE_DRIVE_OPTIMAL_MAX: float = 95.0
KNEE_DRIVE_ISSUE_THRESHOLD: float = 85.0  # below this = issue

# Forward lean (torso lean from vertical during max-velocity)
TORSO_LEAN_OPTIMAL_MIN: float = 5.0
TORSO_LEAN_OPTIMAL_MAX: float = 15.0
TORSO_LEAN_ISSUE_THRESHOLD: float = 25.0  # above this = issue

# Arm drive: range of shoulder-elbow angle across cycle
ARM_DRIVE_OPTIMAL_MIN: float = 90.0
ARM_DRIVE_OPTIMAL_MAX: float = 110.0
ARM_DRIVE_ISSUE_THRESHOLD: float = 80.0  # below this = issue

# Hip extension at toe-off
HIP_EXT_OPTIMAL_MIN: float = 170.0
HIP_EXT_OPTIMAL_MAX: float = 180.0
HIP_EXT_ISSUE_THRESHOLD: float = 170.0  # below this = issue

# Overstriding: ankle ahead of hip at ground contact (normalised x distance)
OVERSTRIDE_THRESHOLD: float = 0.06  # normalised coord units


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class FrameMetrics:
    """Per-frame biomechanical measurements."""

    frame_index: int
    knee_drive_angle: float | None = None
    arm_angle_left: float | None = None
    arm_angle_right: float | None = None
    hip_extension_left: float | None = None
    hip_extension_right: float | None = None
    torso_lean: float | None = None
    ankle_y_left: float | None = None
    ankle_y_right: float | None = None
    hip_x_mid: float | None = None


@dataclass
class DetectedIssue:
    """A biomechanical issue detected during analysis."""

    type: str
    severity: str  # "low" | "medium" | "high"
    measured_value: str
    optimal_range: str
    affected_frames: list[int] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _angle_between_vectors(v1: np.ndarray, v2: np.ndarray) -> float:
    """Return the angle in degrees between two 2-D vectors."""
    dot = float(np.dot(v1, v2))
    mag1 = float(np.linalg.norm(v1))
    mag2 = float(np.linalg.norm(v2))
    if mag1 < 1e-8 or mag2 < 1e-8:
        return 0.0
    cos_angle = np.clip(dot / (mag1 * mag2), -1.0, 1.0)
    return float(math.degrees(math.acos(cos_angle)))


def _angle_at_joint(
    a: np.ndarray, joint: np.ndarray, b: np.ndarray,
) -> float:
    """Return the angle at *joint* formed by points a-joint-b (degrees)."""
    v1 = a - joint
    v2 = b - joint
    return _angle_between_vectors(v1, v2)


def _get_point(kps: np.ndarray, idx: int) -> np.ndarray:
    """Extract (y, x) from the keypoint array."""
    return kps[idx, :2]


def _get_confidence(kps: np.ndarray, idx: int) -> float:
    return float(kps[idx, 2])


def _pick_better_side(
    kps: np.ndarray, left_idx: int, right_idx: int,
) -> str:
    """Return 'left' or 'right' based on which has higher confidence."""
    if _get_confidence(kps, left_idx) >= _get_confidence(kps, right_idx):
        return "left"
    return "right"


# ---------------------------------------------------------------------------
# Per-frame metric computation
# ---------------------------------------------------------------------------

def _compute_frame_metrics(
    kps: np.ndarray, frame_index: int,
) -> FrameMetrics:
    """Compute all per-frame biomechanical metrics.

    Coordinate system: MoveNet normalised coords where y increases downward
    and x increases rightward.  Points are (y, x).
    """
    metrics = FrameMetrics(frame_index=frame_index)

    # --- Knee drive angle (thigh vs vertical) ---
    # Pick the side with higher confidence
    side = _pick_better_side(kps, KP["left_hip"], KP["right_hip"])
    hip_idx = KP[f"{side}_hip"]
    knee_idx = KP[f"{side}_knee"]

    hip = _get_point(kps, hip_idx)
    knee = _get_point(kps, knee_idx)

    # Thigh vector (hip → knee) — in (y, x) space
    thigh_vec = knee - hip  # (dy, dx)
    # Vertical vector (pointing downward in image = positive y)
    vertical = np.array([1.0, 0.0])
    metrics.knee_drive_angle = _angle_between_vectors(thigh_vec, vertical)

    # --- Arm angles (shoulder-elbow relative to torso) ---
    for arm_side in ("left", "right"):
        shoulder_idx = KP[f"{arm_side}_shoulder"]
        elbow_idx = KP[f"{arm_side}_elbow"]
        hip_arm_idx = KP[f"{arm_side}_hip"]

        shoulder = _get_point(kps, shoulder_idx)
        elbow = _get_point(kps, elbow_idx)
        hip_arm = _get_point(kps, hip_arm_idx)

        angle = _angle_at_joint(hip_arm, shoulder, elbow)
        if arm_side == "left":
            metrics.arm_angle_left = angle
        else:
            metrics.arm_angle_right = angle

    # --- Hip extension (shoulder-hip-knee angle) ---
    for h_side in ("left", "right"):
        sh_idx = KP[f"{h_side}_shoulder"]
        hp_idx = KP[f"{h_side}_hip"]
        kn_idx = KP[f"{h_side}_knee"]

        sh = _get_point(kps, sh_idx)
        hp = _get_point(kps, hp_idx)
        kn = _get_point(kps, kn_idx)

        ext = _angle_at_joint(sh, hp, kn)
        if h_side == "left":
            metrics.hip_extension_left = ext
        else:
            metrics.hip_extension_right = ext

    # --- Torso lean (shoulder-hip line vs vertical) ---
    l_sh = _get_point(kps, KP["left_shoulder"])
    r_sh = _get_point(kps, KP["right_shoulder"])
    l_hp = _get_point(kps, KP["left_hip"])
    r_hp = _get_point(kps, KP["right_hip"])

    mid_shoulder = (l_sh + r_sh) / 2.0
    mid_hip = (l_hp + r_hp) / 2.0

    torso_vec = mid_shoulder - mid_hip  # points upward (negative y)
    # Vertical "up" in image coords = negative y
    up_vec = np.array([-1.0, 0.0])
    metrics.torso_lean = _angle_between_vectors(torso_vec, up_vec)

    # --- Ankle y-values (for ground contact / stride frequency estimation) ---
    metrics.ankle_y_left = float(kps[KP["left_ankle"], 0])
    metrics.ankle_y_right = float(kps[KP["right_ankle"], 0])

    # --- Hip midpoint x (for overstriding detection) ---
    metrics.hip_x_mid = float(mid_hip[1])

    return metrics


# ---------------------------------------------------------------------------
# Sprint phase detection
# ---------------------------------------------------------------------------

def _detect_phases(
    metrics_list: list[FrameMetrics],
) -> list[str]:
    """Assign a sprint phase label to each frame based on hip horizontal velocity.

    Phases: 'set', 'acceleration', 'max_velocity', 'deceleration'.
    """
    n = len(metrics_list)
    if n < 3:
        return ["max_velocity"] * n

    # Extract hip midpoint x values
    hip_x = np.array([m.hip_x_mid if m.hip_x_mid is not None else 0.0 for m in metrics_list])

    # Compute velocity (finite difference)
    velocity = np.gradient(hip_x)
    abs_vel = np.abs(velocity)

    # Smooth with a small window
    kernel_size = max(3, n // 10)
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = np.ones(kernel_size) / kernel_size
    smoothed = np.convolve(abs_vel, kernel, mode="same")

    # Determine thresholds
    max_v = float(np.max(smoothed)) if np.max(smoothed) > 1e-8 else 1e-8
    set_threshold = max_v * 0.10
    accel_threshold = max_v * 0.70
    decel_threshold = max_v * 0.70

    phases: list[str] = []
    peak_idx = int(np.argmax(smoothed))

    for i in range(n):
        v = float(smoothed[i])
        if v < set_threshold:
            phases.append("set")
        elif i <= peak_idx:
            if v < accel_threshold:
                phases.append("acceleration")
            else:
                phases.append("max_velocity")
        else:
            if v < decel_threshold:
                phases.append("deceleration")
            else:
                phases.append("max_velocity")

    return phases


# ---------------------------------------------------------------------------
# Stride frequency estimation
# ---------------------------------------------------------------------------

def _estimate_stride_frequency(
    metrics_list: list[FrameMetrics],
    fps: float,
) -> float | None:
    """Estimate stride frequency from ankle y oscillation (strides per second).

    Uses zero-crossing counting on the de-meaned ankle y signal.
    """
    if len(metrics_list) < 6 or fps <= 0:
        return None

    # Use the ankle with higher average confidence indirectly via y-values
    left_y = np.array([m.ankle_y_left or 0.0 for m in metrics_list])
    right_y = np.array([m.ankle_y_right or 0.0 for m in metrics_list])

    # Combined oscillation signal: difference between ankles
    signal = left_y - right_y
    signal = signal - np.mean(signal)

    # Count zero crossings
    crossings = 0
    for i in range(1, len(signal)):
        if signal[i - 1] * signal[i] < 0:
            crossings += 1

    # Each full cycle has 2 zero crossings, each cycle = 1 stride
    duration = len(metrics_list) / fps
    if duration < 0.1:
        return None

    cycles = crossings / 2.0
    frequency = cycles / duration
    return round(frequency, 2) if frequency > 0 else None


# ---------------------------------------------------------------------------
# Ground contact estimation
# ---------------------------------------------------------------------------

def _estimate_ground_contact_frames(
    metrics_list: list[FrameMetrics],
) -> list[dict[str, Any]]:
    """Identify frames where an ankle is near its lowest y-position (ground contact).

    Returns list of dicts with frame_index, side, ankle_x.
    """
    if not metrics_list:
        return []

    left_y = np.array([m.ankle_y_left or 0.0 for m in metrics_list])
    right_y = np.array([m.ankle_y_right or 0.0 for m in metrics_list])

    # "Lowest" in image coords = highest y value
    left_threshold = np.percentile(left_y, 90) if len(left_y) > 0 else 1.0
    right_threshold = np.percentile(right_y, 90) if len(right_y) > 0 else 1.0

    contacts: list[dict[str, Any]] = []
    for i, m in enumerate(metrics_list):
        if m.ankle_y_left is not None and m.ankle_y_left >= left_threshold:
            contacts.append({"frame_index": m.frame_index, "side": "left"})
        if m.ankle_y_right is not None and m.ankle_y_right >= right_threshold:
            contacts.append({"frame_index": m.frame_index, "side": "right"})

    return contacts


# ---------------------------------------------------------------------------
# Issue detection
# ---------------------------------------------------------------------------

def _classify_severity(
    measured: float,
    threshold: float,
    optimal_mid: float,
    higher_is_worse: bool = True,
) -> str:
    """Classify severity based on how far measured is from optimal.

    Returns 'low', 'medium', or 'high'.
    """
    if higher_is_worse:
        deviation = measured - optimal_mid
    else:
        deviation = optimal_mid - measured

    abs_dev = abs(deviation)
    range_to_threshold = abs(threshold - optimal_mid)

    if range_to_threshold < 1e-8:
        return "medium"

    ratio = abs_dev / range_to_threshold
    if ratio < 0.5:
        return "low"
    elif ratio < 1.0:
        return "medium"
    else:
        return "high"


def _detect_issues(
    metrics_list: list[FrameMetrics],
    phases: list[str],
    ground_contacts: list[dict[str, Any]],
    keypoint_frames: list[dict[str, Any]],
) -> list[DetectedIssue]:
    """Compare averaged metrics against reference thresholds to detect issues."""
    issues: list[DetectedIssue] = []
    n = len(metrics_list)
    if n == 0:
        return issues

    # ---- 1. Low knee drive ----
    knee_angles = [m.knee_drive_angle for m in metrics_list if m.knee_drive_angle is not None]
    if knee_angles:
        avg_knee = float(np.mean(knee_angles))
        if avg_knee < KNEE_DRIVE_ISSUE_THRESHOLD:
            affected = [
                m.frame_index
                for m in metrics_list
                if m.knee_drive_angle is not None and m.knee_drive_angle < KNEE_DRIVE_ISSUE_THRESHOLD
            ]
            severity = _classify_severity(
                avg_knee, KNEE_DRIVE_ISSUE_THRESHOLD,
                (KNEE_DRIVE_OPTIMAL_MIN + KNEE_DRIVE_OPTIMAL_MAX) / 2,
                higher_is_worse=False,
            )
            issues.append(
                DetectedIssue(
                    type="low_knee_drive",
                    severity=severity,
                    measured_value=f"{avg_knee:.1f}°",
                    optimal_range=f"{KNEE_DRIVE_OPTIMAL_MIN:.0f}–{KNEE_DRIVE_OPTIMAL_MAX:.0f}°",
                    affected_frames=affected,
                )
            )

    # ---- 2. Excessive forward lean (during max velocity only) ----
    max_vel_indices = [i for i, p in enumerate(phases) if p == "max_velocity"]
    if max_vel_indices:
        torso_angles = [
            metrics_list[i].torso_lean
            for i in max_vel_indices
            if metrics_list[i].torso_lean is not None
        ]
        if torso_angles:
            avg_lean = float(np.mean(torso_angles))
            if avg_lean > TORSO_LEAN_ISSUE_THRESHOLD:
                affected = [
                    metrics_list[i].frame_index
                    for i in max_vel_indices
                    if metrics_list[i].torso_lean is not None
                    and metrics_list[i].torso_lean > TORSO_LEAN_ISSUE_THRESHOLD
                ]
                severity = _classify_severity(
                    avg_lean, TORSO_LEAN_ISSUE_THRESHOLD,
                    (TORSO_LEAN_OPTIMAL_MIN + TORSO_LEAN_OPTIMAL_MAX) / 2,
                    higher_is_worse=True,
                )
                issues.append(
                    DetectedIssue(
                        type="excessive_forward_lean",
                        severity=severity,
                        measured_value=f"{avg_lean:.1f}°",
                        optimal_range=f"{TORSO_LEAN_OPTIMAL_MIN:.0f}–{TORSO_LEAN_OPTIMAL_MAX:.0f}°",
                        affected_frames=affected,
                    )
                )

    # ---- 3. Insufficient arm drive ----
    left_arms = [m.arm_angle_left for m in metrics_list if m.arm_angle_left is not None]
    right_arms = [m.arm_angle_right for m in metrics_list if m.arm_angle_right is not None]
    arm_ranges: list[float] = []
    if left_arms:
        arm_ranges.append(max(left_arms) - min(left_arms))
    if right_arms:
        arm_ranges.append(max(right_arms) - min(right_arms))
    if arm_ranges:
        avg_arm_range = float(np.mean(arm_ranges))
        if avg_arm_range < ARM_DRIVE_ISSUE_THRESHOLD:
            severity = _classify_severity(
                avg_arm_range, ARM_DRIVE_ISSUE_THRESHOLD,
                (ARM_DRIVE_OPTIMAL_MIN + ARM_DRIVE_OPTIMAL_MAX) / 2,
                higher_is_worse=False,
            )
            issues.append(
                DetectedIssue(
                    type="insufficient_arm_drive",
                    severity=severity,
                    measured_value=f"{avg_arm_range:.1f}° range",
                    optimal_range=f"{ARM_DRIVE_OPTIMAL_MIN:.0f}–{ARM_DRIVE_OPTIMAL_MAX:.0f}° range",
                    affected_frames=[m.frame_index for m in metrics_list],
                )
            )

    # ---- 4. Overstriding ----
    overstride_frames: list[int] = []
    for contact in ground_contacts:
        fidx = contact["frame_index"]
        side = contact["side"]
        # Find the corresponding metrics frame
        matching = [m for m in metrics_list if m.frame_index == fidx]
        if not matching:
            continue
        m = matching[0]
        # Find corresponding keypoint data for ankle x
        kp_frame = None
        for kf in keypoint_frames:
            if kf["frame_index"] == fidx:
                kp_frame = kf
                break
        if kp_frame is None:
            continue

        kps = kp_frame["keypoints"]
        ankle_idx = KP[f"{side}_ankle"]
        ankle_x = float(kps[ankle_idx, 1])
        hip_x = m.hip_x_mid if m.hip_x_mid is not None else 0.0

        # Overstriding = ankle lands significantly ahead of hip center
        if abs(ankle_x - hip_x) > OVERSTRIDE_THRESHOLD:
            overstride_frames.append(fidx)

    if overstride_frames:
        ratio = len(overstride_frames) / max(len(ground_contacts), 1)
        if ratio > 0.3:
            if ratio > 0.7:
                severity = "high"
            elif ratio > 0.5:
                severity = "medium"
            else:
                severity = "low"
            avg_dist_values: list[float] = []
            for contact in ground_contacts:
                fidx = contact["frame_index"]
                side = contact["side"]
                matching = [m for m in metrics_list if m.frame_index == fidx]
                if not matching:
                    continue
                m = matching[0]
                kp_frame = None
                for kf in keypoint_frames:
                    if kf["frame_index"] == fidx:
                        kp_frame = kf
                        break
                if kp_frame is None:
                    continue
                kps = kp_frame["keypoints"]
                ankle_idx = KP[f"{side}_ankle"]
                ankle_x = float(kps[ankle_idx, 1])
                hip_x = m.hip_x_mid if m.hip_x_mid is not None else 0.0
                avg_dist_values.append(abs(ankle_x - hip_x))

            avg_dist = float(np.mean(avg_dist_values)) if avg_dist_values else 0.0
            issues.append(
                DetectedIssue(
                    type="overstriding",
                    severity=severity,
                    measured_value=f"{avg_dist:.3f} normalised units ahead of hip",
                    optimal_range="ankle landing under or slightly ahead of hip center",
                    affected_frames=overstride_frames,
                )
            )

    # ---- 5. Low hip extension ----
    hip_ext_values: list[float] = []
    low_ext_frames: list[int] = []
    for m in metrics_list:
        # Use the maximum of left/right (closer to full extension)
        exts = [
            v for v in [m.hip_extension_left, m.hip_extension_right] if v is not None
        ]
        if exts:
            max_ext = max(exts)
            hip_ext_values.append(max_ext)
            if max_ext < HIP_EXT_ISSUE_THRESHOLD:
                low_ext_frames.append(m.frame_index)

    if hip_ext_values:
        avg_ext = float(np.mean(hip_ext_values))
        if avg_ext < HIP_EXT_ISSUE_THRESHOLD:
            severity = _classify_severity(
                avg_ext, HIP_EXT_ISSUE_THRESHOLD,
                (HIP_EXT_OPTIMAL_MIN + HIP_EXT_OPTIMAL_MAX) / 2,
                higher_is_worse=False,
            )
            issues.append(
                DetectedIssue(
                    type="low_hip_extension",
                    severity=severity,
                    measured_value=f"{avg_ext:.1f}°",
                    optimal_range=f"{HIP_EXT_OPTIMAL_MIN:.0f}–{HIP_EXT_OPTIMAL_MAX:.0f}°",
                    affected_frames=low_ext_frames,
                )
            )

    return issues


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze(
    keypoint_frames: list[dict[str, Any]],
    target_fps: int = 10,
) -> dict[str, Any]:
    """Run full biomechanical analysis on non-excluded keypoint frames.

    Args:
        keypoint_frames: List of frame dicts from movenet.process_video()
            (only non-excluded frames should be passed).
        target_fps: The FPS used during frame subsampling.

    Returns:
        A dict with:
            - metrics: list of per-frame FrameMetrics (as dicts)
            - phases: list of phase labels per frame
            - issues: list of DetectedIssue (as dicts)
            - stride_frequency: estimated strides/sec or None
            - ground_contacts: list of ground contact events
            - summary: dict with aggregated metric averages
    """
    if not keypoint_frames:
        logger.warning("No keypoint frames provided to biomechanics.analyze()")
        return {
            "metrics": [],
            "phases": [],
            "issues": [],
            "stride_frequency": None,
            "ground_contacts": [],
            "summary": {},
        }

    # Compute per-frame metrics
    metrics_list: list[FrameMetrics] = []
    for frame_data in keypoint_frames:
        kps = frame_data["keypoints"]
        if isinstance(kps, list):
            kps = np.array(kps)
        fm = _compute_frame_metrics(kps, frame_data["frame_index"])
        metrics_list.append(fm)

    # Sprint phase detection
    phases = _detect_phases(metrics_list)

    # Stride frequency
    stride_freq = _estimate_stride_frequency(metrics_list, float(target_fps))

    # Ground contact estimation
    ground_contacts = _estimate_ground_contact_frames(metrics_list)

    # Issue detection
    issues = _detect_issues(metrics_list, phases, ground_contacts, keypoint_frames)

    # Sort issues by severity for ranking
    severity_order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda issue: severity_order.get(issue.severity, 3))

    # Limit to top 3
    issues = issues[:3]

    # Build summary
    knee_angles = [m.knee_drive_angle for m in metrics_list if m.knee_drive_angle is not None]
    torso_leans = [m.torso_lean for m in metrics_list if m.torso_lean is not None]

    summary: dict[str, Any] = {
        "total_frames_analyzed": len(metrics_list),
        "avg_knee_drive_angle": round(float(np.mean(knee_angles)), 1) if knee_angles else None,
        "avg_torso_lean": round(float(np.mean(torso_leans)), 1) if torso_leans else None,
        "stride_frequency": stride_freq,
        "num_ground_contacts": len(ground_contacts),
        "phase_distribution": {},
    }

    # Phase distribution
    for phase in ["set", "acceleration", "max_velocity", "deceleration"]:
        count = phases.count(phase)
        summary["phase_distribution"][phase] = count

    logger.info(
        "Biomechanical analysis complete: %d issues detected, stride_freq=%s",
        len(issues),
        stride_freq,
    )

    return {
        "metrics": [
            {
                "frame_index": m.frame_index,
                "knee_drive_angle": m.knee_drive_angle,
                "arm_angle_left": m.arm_angle_left,
                "arm_angle_right": m.arm_angle_right,
                "hip_extension_left": m.hip_extension_left,
                "hip_extension_right": m.hip_extension_right,
                "torso_lean": m.torso_lean,
            }
            for m in metrics_list
        ],
        "phases": phases,
        "issues": [
            {
                "type": issue.type,
                "severity": issue.severity,
                "measured_value": issue.measured_value,
                "optimal_range": issue.optimal_range,
                "affected_frames": issue.affected_frames,
            }
            for issue in issues
        ],
        "stride_frequency": stride_freq,
        "ground_contacts": ground_contacts,
        "summary": summary,
    }
