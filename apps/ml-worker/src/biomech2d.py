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
# (30 fps → ±33 ms). Our pose sampling caps effective fps, so temporal metrics are
# honestly experimental until a high-fps temporal path exists (plan Phase 1/4).
FPS_TRUST_GATE = 120.0
# Perspective/scale corrupt vertical CoM off-axis and it is unmeasured on runners
# (honesty ledger #9) — keep it a candidate, never headline-trusted yet.
CANDIDATE = {"vertical_oscillation"}

_VERT_DOWN = np.array([1.0, 0.0])  # image y increases downward
_UP = np.array([-1.0, 0.0])


def _kp(frame: dict) -> np.ndarray:
    k = frame["keypoints"]
    return np.asarray(k) if isinstance(k, list) else k


def _smooth(x: np.ndarray, w: int = 3) -> np.ndarray:
    if len(x) < w:
        return x
    return np.convolve(x, np.ones(w) / w, mode="same")


def _frame_scalars(k: np.ndarray) -> dict[str, float]:
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
    return {
        "knee_drive": _angle_between_vectors(knee - hip, _VERT_DOWN),   # thigh vs vertical, peak
        "hip_ext": _angle_at_joint(sh, hip, knee),                     # shoulder-hip-knee, peak
        "knee_flex": _angle_at_joint(hip, knee, ank),                  # knee joint angle, min=peak flexion
        "elbow": _angle_at_joint(a_sh, a_el, a_wr),                    # arm swing
        "trunk": _angle_between_vectors(mid_sh - mid_hp, _UP),
        "hip_y": float(mid_hp[1]),                                     # vertical oscillation source
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


def _assemble(S: dict[str, list[float]], idxs: list[int], fps: float,
              mean_conf: float, azimuth_deg: float, clip_id: str) -> dict[str, Any]:
    a = {k: np.array(v) for k, v in S.items()}
    # near-side foot contact frames (for overstride)
    contacts = _contact_positions(a["ank_y_rel"])
    overstride_pct = 0.0
    if contacts:
        os_vals = [abs(a["ank_x_rel"][i]) / max(a["leg_len"][i], 1e-6) for i in contacts]
        overstride_pct = min(float(np.median(os_vals)) * 100.0, 40.0)  # clamp implausible off-axis values
    vo_pct = min(float((a["hip_y"].max() - a["hip_y"].min()) / max(np.median(a["torso_len"]), 1e-6)) * 100.0, 25.0)

    # Spatial metrics are harder from a single 2D view (perspective/scale corrupt
    # them off-axis), so down-weight their confidence — they read 'experimental'
    # unless the capture is clean side-on.
    HARDER = {"overstride", "vertical_oscillation"}

    values = {
        "trunk_lean": (float(np.mean(a["trunk"])), int(np.argmin(np.abs(a["trunk"] - np.mean(a["trunk"]))))),
        "knee_drive": (float(np.percentile(a["knee_drive"], 95)), int(np.argmax(a["knee_drive"]))),
        "hip_extension": (float(np.percentile(a["hip_ext"], 95)), int(np.argmax(a["hip_ext"]))),
        "knee_flexion": (float(np.percentile(a["knee_flex"], 5)), int(np.argmin(a["knee_flex"]))),
        "arm_swing": (float(np.mean(a["elbow"])), 0),
        "overstride": (round(overstride_pct, 1), contacts[0] if contacts else 0),
        "vertical_oscillation": (round(vo_pct, 1), 0),
    }
    contact_ms, cadence = _gait(a["l_rel"], a["r_rel"], fps)
    values["contact_time_ms"] = (contact_ms, 0)
    values["cadence_spm"] = (cadence, 0)

    metrics, flaws, recs, per_usable = [], [], [], {}
    phase = "acceleration" if azimuth_deg < 45 else "max_velocity"
    for key, (val, evi) in values.items():
        tier = TIER.get(key, 2)
        if tier == 1:
            # angle-robust → NO viewpoint penalty; trust gated on frame rate.
            vp = 0.0
            conf = mean_conf
            trust = "trusted" if (conf >= 0.6 and fps >= FPS_TRUST_GATE and key not in CANDIDATE) else "experimental"
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
        band = _band(val, conf)
        usable = conf >= 0.35 and val > 0
        per_usable[key] = usable
        metrics.append({"key": key, "measured": band, "unit": UNIT[key],
                        "normalRange": list(NORMAL_RANGE[key]), "comparableAcrossViews": True,
                        "trustStatus": trust})
        lo, hi = NORMAL_RANGE[key]
        if usable and (val < lo or val > hi):
            dev = (lo - val if val < lo else val - hi) / max(hi - lo, 1)
            sev = 3 if dev > 0.5 else 2 if dev > 0.2 else 1
            fid = f"flaw-{key.replace('_', '-')}"
            direction = "below" if val < lo else "above"
            ts = int((idxs[evi] if evi < len(idxs) else 0) / fps * 1000)
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
    if azimuth_deg > 45:
        nudge = "Film from the side (perpendicular to running direction) for trustworthy joint angles."
    elif fps < 60:
        nudge = "Record at 120fps+ for accurate ground-contact and cadence."

    return {
        "id": f"analysis-{clip_id}", "phase": phase, "economyScore": economy,
        "summary": (f"Clean mechanics — nothing flagged. Economy {economy}/100." if not flaws
                    else f"{len(flaws)} thing{'s' if len(flaws) > 1 else ''} to work on. Economy {economy}/100."),
        "flaws": flaws, "recommendations": recs, "metrics": metrics,
        "captureQuality": {"overall": round(overall, 2), "fps": fps, "motionBlur": "low",
                           "framing": "full", "perMetricUsable": per_usable,
                           **({"primaryNudge": nudge} if nudge else {})},
        "reconstructionMethod": "2d", "createdAt": datetime.now(timezone.utc).isoformat(),
    }


_KEYS = ["knee_drive", "hip_ext", "knee_flex", "elbow", "trunk", "hip_y",
         "torso_len", "ank_x_rel", "ank_y_rel", "leg_len", "conf"]


def analyze_2d_sagittal_stream(frame_iter: Iterable[dict], fps: float,
                               azimuth_deg: float, clip_id: str = "clip",
                               min_frames: int = 8, max_frames: int = 450,
                               overlay_out: list | None = None) -> dict[str, Any]:
    """Memory-lean: consume a frame generator in ONE pass, retaining only scalar
    series. Raises low_confidence_video if too few usable frames survive. Stops
    after max_frames to bound worst-case latency.

    If `overlay_out` is provided, it is filled with one record per included frame
    {tMs, kp:[[y,x,conf]x17]} for the mobile skeleton overlay (normalized coords)."""
    S: dict[str, list[float]] = {k: [] for k in _KEYS}
    S["l_rel"] = []; S["r_rel"] = []
    idxs: list[int] = []
    total = 0
    for f in frame_iter:
        total += 1
        if total > max_frames:
            break
        if f.get("excluded"):
            continue
        k = _kp(f)
        sc = _frame_scalars(k)
        for kk in _KEYS:
            S[kk].append(sc[kk])
        # per-side ankle-rel for gait (independent of which side was "better")
        hy = (k[KP["left_hip"], 1] + k[KP["right_hip"], 1]) / 2
        S["l_rel"].append(float(k[KP["left_ankle"], 1] - hy))
        S["r_rel"].append(float(k[KP["right_ankle"], 1] - hy))
        idxs.append(int(f["frame_index"]))
        if overlay_out is not None:
            overlay_out.append({
                "tMs": round(int(f["frame_index"]) / fps * 1000, 1),
                "kp": [[round(float(k[i, 0]), 4), round(float(k[i, 1]), 4), round(float(k[i, 2]), 3)] for i in range(17)],
            })
    included = len(idxs)
    excluded_pct = (total - included) / total if total else 1.0
    if included < min_frames or excluded_pct > 0.60:
        raise ValueError("low_confidence_video")
    mean_conf = float(np.mean(S["conf"]))
    return _assemble(S, idxs, fps, mean_conf, azimuth_deg, clip_id)


def analyze_2d_sagittal(frames: list[dict], fps: float, mean_conf: float,
                        azimuth_deg: float, clip_id: str = "clip") -> dict[str, Any]:
    """List-based variant (kept for callers/tests that already hold frames)."""
    return analyze_2d_sagittal_stream(iter(frames), fps, azimuth_deg, clip_id)
