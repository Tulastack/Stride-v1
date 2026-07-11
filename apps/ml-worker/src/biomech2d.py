"""2D sagittal-plane sprint biomechanics (production path for side/oblique capture).

For a side-on view, sagittal joint angles + temporal metrics can be measured
directly from good 2D keypoints (VideoRun2D-style, ~3-5deg) WITHOUT the fragile
monocular 3D lift. Consumes RTMPose COCO-17 keypoints, emits the @stride/types
AnalysisResult the API/mobile render.

Metrics computed (all from a single side-on view):
  sagittal angles : trunk_lean, knee_drive, hip_extension, knee_flexion, arm_swing
  spatial         : overstride, vertical_oscillation
  temporal        : contact_time_ms, cadence_spm

NOT computable from one side-on view (need frontal/back view or two runs):
  knee valgus, pelvic drop, arm crossover, pronation, true left/right symmetry.

Memory: `analyze_2d_sagittal_stream` consumes a frame generator and retains only
scalar per-frame series — never the full keypoint arrays.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable

import numpy as np
from scipy.signal import savgol_filter

from src.biomechanics import KP, _angle_at_joint, _angle_between_vectors

# lo/hi "healthy" bands (peak-based for angles). Sources: sprint biomech literature.
NORMAL_RANGE: dict[str, tuple[float, float]] = {
    "trunk_lean": (8.0, 22.0),
    "knee_drive": (80.0, 110.0),
    "hip_extension": (160.0, 185.0),
    "knee_flexion": (25.0, 55.0),          # peak swing flexion (min knee angle)
    "arm_swing": (70.0, 110.0),            # mean elbow angle
    "overstride": (0.0, 12.0),             # % of leg length foot lands ahead of hip
    "vertical_oscillation": (4.0, 11.0),   # bounce as % of torso length
    "contact_time_ms": (80.0, 140.0),
    "cadence_spm": (270.0, 330.0),
}
# Hard PHYSICAL envelope — wider than the "healthy" band. A value outside this is
# a measurement failure (off-axis perspective, bad crop, a static-bystander lock,
# or sub-Nyquist temporal sampling), not a real fault. Such a value is never shown
# as "trusted" and never raises a flaw — it is honest to say "couldn't measure"
# rather than to flag a garbage number. See _assemble's plausibility gate.
PLAUSIBLE: dict[str, tuple[float, float]] = {
    "trunk_lean": (0.0, 40.0),
    "knee_drive": (0.0, 135.0),
    "hip_extension": (80.0, 200.0),
    "knee_flexion": (5.0, 150.0),
    "arm_swing": (20.0, 160.0),
    "overstride": (0.0, 20.0),
    "vertical_oscillation": (0.0, 20.0),
    "contact_time_ms": (60.0, 400.0),
    "cadence_spm": (140.0, 360.0),
}
UNIT = {"trunk_lean": "deg", "knee_drive": "deg", "hip_extension": "deg",
        "knee_flexion": "deg", "arm_swing": "deg", "overstride": "%",
        "vertical_oscillation": "%", "contact_time_ms": "ms", "cadence_spm": "spm"}
PLANE = {"trunk_lean": "sagittal", "knee_drive": "sagittal", "hip_extension": "sagittal",
         "knee_flexion": "sagittal", "arm_swing": "sagittal", "overstride": "sagittal",
         "vertical_oscillation": "temporal", "contact_time_ms": "temporal", "cadence_spm": "temporal"}

DRILLS: dict[str, dict[str, Any]] = {
    "trunk_lean": {"drillId": "drill-wall-drive", "drillName": "Wall drives", "cue": "Hold a long line from ankle to head; resist bending at the waist.", "demoAssetId": "demo-wall-drive", "sets": 3, "reps": 8, "rationale": "Grooves a stable trunk angle."},
    "knee_drive": {"drillId": "drill-high-knee-switch", "drillName": "High-knee wall switches", "cue": "Punch the knee up to hip height, toe up.", "demoAssetId": "demo-high-knee-switch", "sets": 3, "reps": 10, "rationale": "Trains a higher knee-drive position."},
    "hip_extension": {"drillId": "drill-dribble-bound", "drillName": "Dribble-to-bound build-ups", "cue": "Feel the back leg finish long behind you.", "demoAssetId": "demo-dribble-bound", "sets": 4, "reps": 6, "rationale": "Cues full hip extension at toe-off."},
    "knee_flexion": {"drillId": "drill-heel-recovery", "drillName": "Heel-to-butt A-skips", "cue": "Snap the heel up under your glute as the knee drives.", "demoAssetId": "demo-heel-recovery", "sets": 3, "reps": 8, "rationale": "Improves swing-leg knee flexion and recovery speed."},
    "arm_swing": {"drillId": "drill-arm-iso", "drillName": "Seated arm-drive isolation", "cue": "Drive elbows straight back, hands cheek-to-hip; don't cross the midline.", "demoAssetId": "demo-arm-iso", "sets": 3, "reps": 20, "rationale": "Keeps arm drive front-to-back for less rotational braking."},
    "overstride": {"drillId": "drill-quick-feet", "drillName": "Quick-feet + cadence intervals", "cue": "Land the foot UNDER your hip, not out in front. Quicker, lighter steps.", "demoAssetId": "demo-quick-feet", "sets": 4, "reps": 30, "rationale": "Reduces overstride and braking impulse."},
    "vertical_oscillation": {"drillId": "drill-wickets", "drillName": "Wicket runs", "cue": "Run TALL and flat — push horizontally, minimise bounce.", "demoAssetId": "demo-wickets", "sets": 3, "reps": 6, "rationale": "Lowers wasteful vertical oscillation."},
    "contact_time_ms": {"drillId": "drill-banded-starts", "drillName": "Resisted banded starts", "cue": "Punch the ground and get off it fast.", "demoAssetId": "demo-banded-starts", "sets": 4, "reps": 5, "rationale": "Shortens ground-contact time."},
    "cadence_spm": {"drillId": "drill-metronome", "drillName": "Metronome cadence intervals", "cue": "Match your footfalls to the beat; quick, light steps.", "demoAssetId": "demo-metronome", "sets": 4, "reps": 30, "rationale": "Raises step frequency toward the efficient range."},
}
NAMES = {"trunk_lean": "Trunk angle off-target", "knee_drive": "Low knee drive",
         "hip_extension": "Limited hip extension", "knee_flexion": "Limited knee flexion",
         "arm_swing": "Arm swing off-target", "overstride": "Overstriding",
         "vertical_oscillation": "Excess vertical bounce", "contact_time_ms": "Long ground contact",
         "cadence_spm": "Cadence off-target"}
# short "why it matters" used by the results UI + coach grounding.
WHY = {
    "trunk_lean": "A slight forward lean from the ankles keeps you driving forward; too upright or bent-at-the-waist wastes force.",
    "knee_drive": "Higher knee drive sets up a longer, more powerful stride.",
    "hip_extension": "Finishing the drive behind you is where most of your propulsion comes from.",
    "knee_flexion": "A well-flexed swing leg shortens the lever so the leg recovers faster.",
    "arm_swing": "Arms driving front-to-back (not across the body) reduce rotational braking.",
    "overstride": "Landing your foot ahead of your hips brakes you on every step and loads the knee. This is the #1 efficiency leak.",
    "vertical_oscillation": "Energy spent bouncing up is energy not spent moving forward.",
    "contact_time_ms": "Less time on the ground generally means a springier, faster stride (needs high-fps video to measure well).",
    "cadence_spm": "Quicker, lighter steps usually cut overstriding and braking (needs high-fps video to measure well).",
}

# ── Trust tiers (docs/research/angle-agnostic-kinematics.md) ──────────────────
# Trust by variable TYPE, not by azimuth. Tier 1 = angle-robust but frame-rate-
# gated; Tier 2 = sagittal (best side-on, degraded off-axis); Tier 3 = rebinned /
# translation-dependent → descriptive only, never "trusted".
TIER = {
    "cadence_spm": 1, "contact_time_ms": 1, "vertical_oscillation": 1,
    "trunk_lean": 2, "knee_drive": 2, "hip_extension": 2, "knee_flexion": 2, "arm_swing": 2,
    "overstride": 3,
}
# Sprint ground contact is ~90 ms; below ~120 fps the timing error swamps the signal
# (30 fps → ±33 ms). Gate on the KEYPOINT sample rate (pose fps), not capture fps —
# pose subsampling also limits temporal resolution. Report capture fps separately.
FPS_TRUST_GATE = 120.0
# Perspective/scale corrupt vertical CoM off-axis and it is unmeasured on runners
# (honesty ledger #9) — keep it a candidate, never headline-trusted yet.
CANDIDATE = {"vertical_oscillation"}

_VERT_DOWN = np.array([1.0, 0.0])  # image coords are [y, x]; y increases downward
_UP = np.array([-1.0, 0.0])


def _kp(frame: dict) -> np.ndarray:
    k = frame["keypoints"]
    return np.asarray(k) if isinstance(k, list) else k


def _smooth(x: np.ndarray, w: int = 3) -> np.ndarray:
    if len(x) < w:
        return x
    return np.convolve(x, np.ones(w) / w, mode="same")


def _savgol(x: np.ndarray, w: int = 5, p: int = 2) -> np.ndarray:
    """Causal-friendly Savitzky-Golay smoothing for per-frame angle series.

    Kept SHORT on purpose: at pose_fps=15 an 11-tap window (~730 ms) is longer
    than a full swing phase (~250-350 ms) and would flatten the very peaks
    (max knee drive, peak swing flexion) the metrics report. A 5-tap window is
    ~330 ms — long enough to kill per-frame jitter, short enough to keep peaks.
    Analysis is a queued job, so a non-causal filter is fine here."""
    n = len(x)
    if n < 5:
        return x
    wl = min(w, n)
    if wl % 2 == 0:
        wl -= 1
    if wl <= p:
        return x
    return np.asarray(savgol_filter(x, wl, p), dtype=float)


def _unit2(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-8 else v


def resolve_image_axes(image_down: tuple[float, float] | None) -> tuple[np.ndarray, np.ndarray]:
    """Gravity-anchored image vertical in [y, x] coords (research Phase 1).

    When the phone is pitched/rolled, measuring angles against image-Y corrupts
    trunk/knee metrics. Prefer a capture-provided image-plane gravity projection;
    fall back to image-Y. Head-on sagittal depth remains unrecoverable.
    """
    if image_down is None:
        return _VERT_DOWN.copy(), _UP.copy()
    down = _unit2(np.array([float(image_down[0]), float(image_down[1])], dtype=float))
    if float(np.linalg.norm(down)) < 1e-6:
        return _VERT_DOWN.copy(), _UP.copy()
    return down, -down


def estimate_azimuth_from_keypoints(k: np.ndarray) -> float | None:
    """Hip/shoulder width ratio → azimuth (0° = side-on). Same heuristic as pipeline3d."""
    ls, rs = k[KP["left_shoulder"]], k[KP["right_shoulder"]]
    lh, rh = k[KP["left_hip"]], k[KP["right_hip"]]
    if min(ls[2], rs[2], lh[2], rh[2]) < 0.3:
        return None
    # keypoints are [y, x, conf] — width is along x (index 1)
    sw = abs(float(rs[1] - ls[1]))
    if sw < 1e-4:
        return None
    hw = abs(float(rh[1] - lh[1]))
    r = min(1.0, hw / sw)
    return round(math.degrees(math.acos(max(0.0, min(1.0, r)))), 1)


def _frame_scalars(k: np.ndarray, vert_down: np.ndarray, up: np.ndarray) -> dict[str, float]:
    """Extract per-frame scalars we retain (discarding the 17x3 keypoints)."""
    s = "left" if k[KP["left_hip"], 2] >= k[KP["right_hip"], 2] else "right"
    hip, knee, ank = k[KP[f"{s}_hip"], :2], k[KP[f"{s}_knee"], :2], k[KP[f"{s}_ankle"], :2]
    sh = k[KP[f"{s}_shoulder"], :2]
    # arm: pick the higher-confidence elbow/wrist side
    arm = "left" if (k[KP["left_elbow"], 2] + k[KP["left_wrist"], 2]) >= (k[KP["right_elbow"], 2] + k[KP["right_wrist"], 2]) else "right"
    a_sh, a_el, a_wr = k[KP[f"{arm}_shoulder"], :2], k[KP[f"{arm}_elbow"], :2], k[KP[f"{arm}_wrist"], :2]
    mid_sh = (k[KP["left_shoulder"], :2] + k[KP["right_shoulder"], :2]) / 2
    mid_hp = (k[KP["left_hip"], :2] + k[KP["right_hip"], :2]) / 2
    leg_len = float(np.linalg.norm(ank - hip)) or 1e-6
    # Project hip position onto gravity axis for vertical oscillation (candidate).
    hip_vert = float(np.dot(mid_hp, vert_down))
    return {
        "knee_drive": _angle_between_vectors(knee - hip, vert_down),   # thigh vs gravity vertical
        "hip_ext": _angle_at_joint(sh, hip, knee),                     # shoulder-hip-knee, peak
        "knee_flex": _angle_at_joint(hip, knee, ank),                  # knee joint angle, min=peak flexion
        "elbow": _angle_at_joint(a_sh, a_el, a_wr),                    # arm swing
        "trunk": _angle_between_vectors(mid_sh - mid_hp, up),
        "hip_y": hip_vert,
        "torso_len": float(np.linalg.norm(mid_sh - mid_hp)) or 1e-6,
        "ank_x_rel": float(ank[0] - mid_hp[0]),                        # foot horizontal vs hip (overstride)
        "ank_y_rel": float(ank[1] - mid_hp[1]),                        # foot vertical vs hip (contact)
        "leg_len": leg_len,
        "conf": float(np.mean(k[:, 2])),
    }


def _contact_positions(ank_y_rel: np.ndarray) -> list[int]:
    """Frame indices where the (near) foot is planted — local maxima of the
    pelvis-relative ankle height (foot lowest in image)."""
    y = _smooth(ank_y_rel)
    if len(y) < 3 or y.max() - y.min() < 1e-3:
        return []
    thr = y.min() + (y.max() - y.min()) * 0.7
    out, refractory = [], 0
    for i in range(1, len(y) - 1):
        if refractory <= 0 and y[i] >= thr and y[i] >= y[i - 1] and y[i] >= y[i + 1]:
            out.append(i)
            refractory = 4
        refractory -= 1
    return out


def _gait(lank: np.ndarray, rank: np.ndarray, fps: float) -> tuple[float, float]:
    strikes: list[int] = []
    contact_runs: list[int] = []
    for rel in (lank, rank):
        rs = _smooth(rel)
        if len(rs) == 0 or rs.max() - rs.min() < 1e-3:
            continue
        thr = rs.min() + (rs.max() - rs.min()) * 0.6
        run = 0
        for v in rs:
            if v >= thr:
                run += 1
            else:
                if run >= 1:
                    contact_runs.append(run)
                run = 0
        strikes += _contact_positions(rel)
    strikes.sort()
    intervals = [(strikes[i] - strikes[i - 1]) / fps for i in range(1, len(strikes))]
    intervals = [d for d in intervals if d > 0.5 / fps]
    cadence = 60.0 / float(np.mean(intervals)) if intervals else 0.0
    contact_ms = float(np.mean(contact_runs)) / fps * 1000 if contact_runs else 0.0
    return round(contact_ms, 1), round(cadence, 1)


def _viewpoint_penalty(azimuth_deg: float, plane: str) -> float:
    a = math.radians(abs(azimuth_deg) % 180)
    out = math.sin(a) ** 2
    return min(1.0, out) if plane == "sagittal" else min(1.0, out * 0.25)


def _band(value: float, conf: float) -> dict[str, float]:
    span = max(abs(value), 1.0)
    half = span * (0.04 + 0.6 * (1 - conf))
    return {"value": round(value, 1), "low": round(value - half, 1),
            "high": round(value + half, 1), "confidence": round(conf, 2)}


def _assemble(S: dict[str, list[float]], idxs: list[int], pose_fps: float,
              mean_conf: float, azimuth_deg: float, clip_id: str,
              capture_fps: float | None = None, source_fps: float | None = None) -> dict[str, Any]:
    """Assemble metrics. `pose_fps` = keypoint sample rate (gait timing);
    `capture_fps` = phone capture rate (reported quality + nudges);
    `source_fps` = video container fps (flaw evidence timestamps)."""
    a = {k: np.array(v) for k, v in S.items()}
    # Kill per-frame keypoint jitter on the angle series BEFORE taking peak
    # percentiles — raw jitter inflates the p95/p5 extremes the metrics report.
    for _ak in ("knee_drive", "hip_ext", "knee_flex", "elbow", "trunk"):
        a[_ak] = _savgol(a[_ak])
    cap_fps = float(capture_fps if capture_fps is not None else pose_fps)
    src_fps = float(source_fps if source_fps is not None else pose_fps)
    # near-side foot contact frames (for overstride)
    contacts = _contact_positions(a["ank_y_rel"])
    overstride_pct = 0.0
    if contacts:
        os_vals = [abs(a["ank_x_rel"][i]) / max(a["leg_len"][i], 1e-6) for i in contacts]
        overstride_pct = min(float(np.median(os_vals)) * 100.0, 40.0)  # clamp implausible off-axis values
    vo_pct = min(float((a["hip_y"].max() - a["hip_y"].min()) / max(np.median(a["torso_len"]), 1e-6)) * 100.0, 25.0)

    # ── Static-subject guard (the "guard" half of the P0 fix) ──────────────────
    # A running subject's near ankle swings strongly in image-y each stride; a
    # tracker that latched onto a standing bystander barely moves. If vertical
    # ankle travel (as a fraction of leg length) is below a floor, the locked
    # target is almost certainly not the runner — so we refuse to raise any
    # authoritative flaw from it and say so, rather than emitting a low-economy
    # result full of "experimental" numbers that looks like a real (bad) run.
    _leg = max(float(np.median(a["leg_len"])), 1e-6)
    subject_motion = round(max(float(a["l_rel"].max() - a["l_rel"].min()),
                               float(a["r_rel"].max() - a["r_rel"].min())) / _leg, 2)
    moving_subject = subject_motion >= 0.25

    # trunk_lean / arm_swing use a robust MEDIAN, not mean: a clip can mix phases
    # (e.g. a sprint block-start holds a bent "set" pose + straight bracing arms
    # for many frames, then drives out) and occlusion outliers — mean is corrupted
    # by those, median tracks the representative posture. The peak metrics below
    # keep percentiles because the PEAK is the point of interest.
    _trunk_med = float(np.median(a["trunk"]))
    _elbow_med = float(np.median(a["elbow"]))
    values = {
        "trunk_lean": (_trunk_med, int(np.argmin(np.abs(a["trunk"] - _trunk_med)))),
        "knee_drive": (float(np.percentile(a["knee_drive"], 95)), int(np.argmax(a["knee_drive"]))),
        "hip_extension": (float(np.percentile(a["hip_ext"], 95)), int(np.argmax(a["hip_ext"]))),
        "knee_flexion": (float(np.percentile(a["knee_flex"], 5)), int(np.argmin(a["knee_flex"]))),
        "arm_swing": (_elbow_med, int(np.argmin(np.abs(a["elbow"] - _elbow_med)))),
        "overstride": (round(overstride_pct, 1), contacts[0] if contacts else 0),
        "vertical_oscillation": (round(vo_pct, 1), 0),
    }
    contact_ms, cadence = _gait(a["l_rel"], a["r_rel"], pose_fps)
    values["contact_time_ms"] = (contact_ms, 0)
    values["cadence_spm"] = (cadence, 0)

    # Temporal trust needs BOTH high capture rate and dense keypoints.
    temporal_fps = min(cap_fps, pose_fps)

    metrics, flaws, recs, per_usable = [], [], [], {}
    phase = "acceleration" if azimuth_deg < 45 else "max_velocity"
    for key, (val, evi) in values.items():
        tier = TIER.get(key, 2)
        if tier == 1:
            # angle-robust → NO viewpoint penalty; trust gated on frame rate.
            vp = 0.0
            conf = mean_conf
            trust = "trusted" if (conf >= 0.6 and temporal_fps >= FPS_TRUST_GATE and key not in CANDIDATE) else "experimental"
        elif tier == 3:
            # rebinned / translation-dependent → descriptive, never "trusted".
            vp = _viewpoint_penalty(azimuth_deg, "sagittal")
            conf = mean_conf * (1 - vp) * 0.6
            trust = "experimental"
        else:
            # Tier 2 sagittal → best side-on, degraded (not zeroed) off-axis.
            vp = _viewpoint_penalty(azimuth_deg, "sagittal")
            conf = mean_conf * (1 - vp)
            trust = "trusted" if (conf >= 0.6 and vp <= 0.5) else "experimental"
        conf = max(0.0, min(1.0, conf))
        # Plausibility backstop: a value outside the physical envelope is a failed
        # measurement (off-axis perspective, static-bystander lock, sub-Nyquist
        # timing) — demote it to experimental so it is never shown as trusted.
        plo, phi = PLAUSIBLE.get(key, (float("-inf"), float("inf")))
        plausible = (val > 0) and (plo <= val <= phi)
        if not plausible:
            trust = "experimental"
        band = _band(val, conf)
        usable = conf >= 0.35 and plausible
        per_usable[key] = usable
        metrics.append({"key": key, "measured": band, "unit": UNIT[key],
                        "normalRange": list(NORMAL_RANGE[key]), "comparableAcrossViews": True,
                        "trustStatus": trust, "tier": tier})
        lo, hi = NORMAL_RANGE[key]
        # Only a TRUSTED, plausible metric may raise an authoritative flaw + drill.
        # Experimental/descriptive metrics (temporal below the fps gate, tier-3
        # spatial, off-axis angles) are reported with their value but never flagged
        # as faults — that is the honesty fix for the "garbage wearing a trusted
        # badge / false-flaw every clip" failures found in the baseline. And a
        # non-moving (static-lock) subject never raises a flaw at all.
        if moving_subject and trust == "trusted" and usable and (val < lo or val > hi):
            dev = (lo - val if val < lo else val - hi) / max(hi - lo, 1)
            sev = 3 if dev > 0.5 else 2 if dev > 0.2 else 1
            fid = f"flaw-{key.replace('_', '-')}"
            direction = "below" if val < lo else "above"
            # Map source frame_index → video wall-clock ms (NOT pose sample rate).
            frame_i = idxs[evi] if evi < len(idxs) else 0
            ts = int(frame_i / max(src_fps, 1e-6) * 1000)
            flaws.append({
                "id": fid, "name": NAMES[key], "phase": phase, "severity": sev,
                "plainExplanation": f"Your {key.replace('_', ' ')} ({val:.0f}{UNIT[key]}) is {direction} the typical {lo:.0f}-{hi:.0f}{UNIT[key]}. {WHY[key]}",
                "evidence": {"frameTimestampMs": ts,
                             "jointAngles3D": {"knee_drive": round(values['knee_drive'][0], 1), "hip_extension": round(values['hip_extension'][0], 1), "trunk_lean": round(values['trunk_lean'][0], 1)},
                             "measured": band, "normalRange": list(NORMAL_RANGE[key]), "viewpointPenalty": round(vp, 2)},
            })
            recs.append({"flawId": fid, **DRILLS[key]})

    # Running economy: composite 0-100 from how close usable metrics sit to their band.
    econ_terms = []
    for m in metrics:
        k = m["key"]; v = m["measured"]["value"]
        if not per_usable[k] or v <= 0:
            continue
        lo, hi = NORMAL_RANGE[k]
        mid = (lo + hi) / 2; half = max((hi - lo) / 2, 1e-6)
        econ_terms.append(max(0.0, 1.0 - abs(v - mid) / (half * 2)))
    economy = int(round(100 * (sum(econ_terms) / len(econ_terms)))) if econ_terms else 0

    overall = float(np.mean([m["measured"]["confidence"] for m in metrics]))
    nudge = None
    if not moving_subject:
        nudge = "Couldn't lock onto a clearly running subject — make sure the runner is centered (or brush to select them) and moving across the frame."
    elif azimuth_deg > 45:
        nudge = "Film from the side (perpendicular to running direction) for trustworthy joint angles."
    elif cap_fps < 60:
        nudge = "Record at 120fps+ for accurate ground-contact and cadence."

    if not moving_subject:
        summary = f"Couldn't get a clear read on a running subject in this clip. Economy {economy}/100."
    elif not flaws:
        summary = f"Clean mechanics — nothing flagged. Economy {economy}/100."
    else:
        summary = f"{len(flaws)} thing{'s' if len(flaws) > 1 else ''} to work on. Economy {economy}/100."

    return {
        "id": f"analysis-{clip_id}", "phase": phase, "economyScore": economy,
        "summary": summary,
        "flaws": flaws, "recommendations": recs, "metrics": metrics,
        "captureQuality": {"overall": round(overall, 2), "fps": round(cap_fps, 1),
                           "poseFps": round(pose_fps, 1), "motionBlur": "low",
                           "framing": "full", "perMetricUsable": per_usable,
                           "cameraAzimuthDeg": round(azimuth_deg, 1),
                           "subjectMotion": subject_motion, "movingSubject": moving_subject,
                           **({"primaryNudge": nudge} if nudge else {})},
        "reconstructionMethod": "2d", "createdAt": datetime.now(timezone.utc).isoformat(),
    }


_KEYS = ["knee_drive", "hip_ext", "knee_flex", "elbow", "trunk", "hip_y",
         "torso_len", "ank_x_rel", "ank_y_rel", "leg_len", "conf"]


def analyze_2d_sagittal_stream(frame_iter: Iterable[dict], fps: float,
                               azimuth_deg: float, clip_id: str = "clip",
                               min_frames: int = 8, max_frames: int = 450,
                               overlay_out: list | None = None,
                               source_fps: float | None = None,
                               capture_fps: float | None = None,
                               image_down: tuple[float, float] | None = None,
                               estimate_azimuth: bool = True) -> dict[str, Any]:
    """Memory-lean: consume a frame generator in ONE pass, retaining only scalar
    series. Raises low_confidence_video if too few usable frames survive. Stops
    after max_frames to bound worst-case latency.

    fps          — pose sample rate (gait timing between retained frames)
    source_fps   — video container fps (overlay / evidence wall-clock timestamps)
    capture_fps  — phone capture rate (quality reporting + temporal trust gate)
    image_down   — optional gravity projection in image [y, x] coords

    If `overlay_out` is provided, it is filled with one record per included frame
    {tMs, frameIndex, kp:[[y,x,conf]x17]} for the mobile skeleton overlay."""
    pose_fps = float(fps)
    src_fps = float(source_fps if source_fps is not None else pose_fps)
    cap_fps = float(capture_fps if capture_fps is not None else pose_fps)
    vert_down, up = resolve_image_axes(image_down)

    S: dict[str, list[float]] = {k: [] for k in _KEYS}
    S["l_rel"] = []; S["r_rel"] = []
    idxs: list[int] = []
    az_samples: list[float] = []
    total = 0
    for f in frame_iter:
        total += 1
        if total > max_frames:
            break
        if f.get("excluded"):
            continue
        k = _kp(f)
        sc = _frame_scalars(k, vert_down, up)
        for kk in _KEYS:
            S[kk].append(sc[kk])
        # per-side ankle-rel for gait (independent of which side was "better")
        hy = (k[KP["left_hip"], 1] + k[KP["right_hip"], 1]) / 2
        S["l_rel"].append(float(k[KP["left_ankle"], 1] - hy))
        S["r_rel"].append(float(k[KP["right_ankle"], 1] - hy))
        fi = int(f["frame_index"])
        idxs.append(fi)
        if estimate_azimuth:
            az = estimate_azimuth_from_keypoints(k)
            if az is not None:
                az_samples.append(az)
        if overlay_out is not None:
            # CRITICAL: frame_index is the SOURCE video frame number → divide by
            # source_fps, not pose sample rate (that inflated tMs by source/pose).
            overlay_out.append({
                "tMs": round(fi / max(src_fps, 1e-6) * 1000, 1),
                "frameIndex": fi,
                "kp": [[round(float(k[i, 0]), 4), round(float(k[i, 1]), 4), round(float(k[i, 2]), 3)] for i in range(17)],
            })
    included = len(idxs)
    excluded_pct = (total - included) / total if total else 1.0
    if included < min_frames or excluded_pct > 0.60:
        raise ValueError("low_confidence_video")
    mean_conf = float(np.mean(S["conf"]))
    # Prefer keypoint-estimated azimuth over the static default when available.
    use_az = float(azimuth_deg)
    if estimate_azimuth and az_samples:
        use_az = float(np.median(az_samples))
    return _assemble(S, idxs, pose_fps, mean_conf, use_az, clip_id,
                     capture_fps=cap_fps, source_fps=src_fps)


def analyze_2d_sagittal(frames: list[dict], fps: float, mean_conf: float,
                        azimuth_deg: float, clip_id: str = "clip",
                        source_fps: float | None = None,
                        capture_fps: float | None = None,
                        image_down: tuple[float, float] | None = None) -> dict[str, Any]:
    """List-based variant (kept for callers/tests that already hold frames)."""
    return analyze_2d_sagittal_stream(
        iter(frames), fps, azimuth_deg, clip_id,
        source_fps=source_fps, capture_fps=capture_fps, image_down=image_down,
    )
