"""2D sagittal-plane sprint biomechanics (production path for side/oblique capture).

Rationale (validated against the literature, e.g. VideoRun2D): for a side-on view,
sagittal joint angles can be measured directly from good 2D keypoints at 3–5° error
— WITHOUT the fragile monocular 3D lift. This module consumes RTMPose keypoints and
emits the exact @stride/types AnalysisResult the API/mobile already render.

Correctness: peak-based metrics (knee drive, hip extension) use the PEAK over the
stride, not the clip average; gait metrics use the pelvis-relative ankle signal so a
runner translating through frame does not corrupt stance detection.

Memory: `analyze_2d_sagittal_stream` consumes a frame *generator* and retains only
scalar per-frame series (a few floats/frame) — never the full keypoint arrays — so
peak memory is O(1) frames + O(N) scalars regardless of clip length.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

import numpy as np

from src.biomechanics import KP, _angle_at_joint, _angle_between_vectors

NORMAL_RANGE: dict[str, tuple[float, float]] = {
    "trunk_lean": (8.0, 22.0),
    "knee_drive": (80.0, 110.0),
    "hip_extension": (160.0, 185.0),
    "contact_time_ms": (80.0, 140.0),
    "cadence_spm": (270.0, 330.0),
}
UNIT = {"trunk_lean": "deg", "knee_drive": "deg", "hip_extension": "deg",
        "contact_time_ms": "ms", "cadence_spm": "spm"}
PLANE = {"trunk_lean": "sagittal", "knee_drive": "sagittal", "hip_extension": "sagittal",
         "contact_time_ms": "temporal", "cadence_spm": "temporal"}

DRILLS: dict[str, dict[str, Any]] = {
    "trunk_lean": {"drillId": "drill-wall-drive", "drillName": "Wall drives", "cue": "Hold a long line from ankle to head; resist bending at the waist.", "demoAssetId": "demo-wall-drive", "sets": 3, "reps": 8, "rationale": "Grooves a stable trunk angle."},
    "knee_drive": {"drillId": "drill-high-knee-switch", "drillName": "High-knee wall switches", "cue": "Punch the knee up to hip height, toe up.", "demoAssetId": "demo-high-knee-switch", "sets": 3, "reps": 10, "rationale": "Trains a higher knee-drive position."},
    "hip_extension": {"drillId": "drill-dribble-bound", "drillName": "Dribble-to-bound build-ups", "cue": "Feel the back leg finish long behind you.", "demoAssetId": "demo-dribble-bound", "sets": 4, "reps": 6, "rationale": "Cues full hip extension at toe-off."},
    "contact_time_ms": {"drillId": "drill-banded-starts", "drillName": "Resisted banded starts", "cue": "Punch the ground and get off it fast.", "demoAssetId": "demo-banded-starts", "sets": 4, "reps": 5, "rationale": "Shortens ground-contact time."},
    "cadence_spm": {"drillId": "drill-wickets", "drillName": "Wicket runs", "cue": "Quick feet, snap each step down.", "demoAssetId": "demo-wickets", "sets": 3, "reps": 6, "rationale": "Raises step frequency."},
}
NAMES = {"trunk_lean": "Trunk angle off-target", "knee_drive": "Low knee drive",
         "hip_extension": "Limited hip extension", "contact_time_ms": "Long ground contact",
         "cadence_spm": "Cadence off-target"}

_VERT_DOWN = np.array([1.0, 0.0])  # image y increases downward
_UP = np.array([-1.0, 0.0])


def _kp(frame: dict) -> np.ndarray:
    k = frame["keypoints"]
    return np.asarray(k) if isinstance(k, list) else k


def _smooth(x: np.ndarray, w: int = 3) -> np.ndarray:
    if len(x) < w:
        return x
    return np.convolve(x, np.ones(w) / w, mode="same")


def _frame_scalars(k: np.ndarray) -> tuple[float, float, float, float, float, float]:
    """Extract the per-frame scalars we retain (discarding the 17×3 keypoints):
    (knee_drive_deg, hip_ext_deg, trunk_deg, l_ankle_rel_y, r_ankle_rel_y, mean_conf)."""
    s = "left" if k[KP["left_hip"], 2] >= k[KP["right_hip"], 2] else "right"
    hip, knee = k[KP[f"{s}_hip"], :2], k[KP[f"{s}_knee"], :2]
    sh = k[KP[f"{s}_shoulder"], :2]
    knee_drive = _angle_between_vectors(knee - hip, _VERT_DOWN)
    hip_ext = _angle_at_joint(sh, hip, knee)
    mid_sh = (k[KP["left_shoulder"], :2] + k[KP["right_shoulder"], :2]) / 2
    mid_hp = (k[KP["left_hip"], :2] + k[KP["right_hip"], :2]) / 2
    trunk = _angle_between_vectors(mid_sh - mid_hp, _UP)
    hip_y = (k[KP["left_hip"], 0] + k[KP["right_hip"], 0]) / 2
    l_rel = float(k[KP["left_ankle"], 0] - hip_y)
    r_rel = float(k[KP["right_ankle"], 0] - hip_y)
    return knee_drive, hip_ext, trunk, l_rel, r_rel, float(np.mean(k[:, 2]))


def _strikes_from_series(rel: np.ndarray, fps: float) -> list[int]:
    rel = _smooth(rel)
    if len(rel) < 3 or rel.max() - rel.min() < 1e-3:
        return []
    thr = rel.min() + (rel.max() - rel.min()) * 0.7  # foot low in image = near ground
    strikes, refractory = [], 0
    for i in range(1, len(rel) - 1):
        if refractory <= 0 and rel[i] >= thr and rel[i] >= rel[i - 1] and rel[i] >= rel[i + 1]:
            strikes.append(i)
            refractory = 4
        refractory -= 1
    return strikes


def _gait_from_series(lank: np.ndarray, rank: np.ndarray, fps: float) -> tuple[float, float]:
    all_strikes: list[int] = []
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
        all_strikes += _strikes_from_series(rel, fps)
    all_strikes.sort()
    intervals = [(all_strikes[i] - all_strikes[i - 1]) / fps for i in range(1, len(all_strikes))]
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


def _assemble(knee: list[float], hip: list[float], trunk: list[float],
              lank: list[float], rank: list[float], frame_indices: list[int],
              fps: float, mean_conf: float, azimuth_deg: float, clip_id: str) -> dict[str, Any]:
    knee_a, hip_a, trunk_a = np.array(knee), np.array(hip), np.array(trunk)
    knee_peak = float(np.percentile(knee_a, 95)); knee_evi = int(np.argmax(knee_a))
    hip_peak = float(np.percentile(hip_a, 95)); hip_evi = int(np.argmax(hip_a))
    trunk_mean = float(np.mean(trunk_a)); trunk_evi = int(np.argmin(np.abs(trunk_a - trunk_mean)))
    contact_ms, cadence = _gait_from_series(np.array(lank), np.array(rank), fps)

    raw = {"trunk_lean": (trunk_mean, trunk_evi), "knee_drive": (knee_peak, knee_evi),
           "hip_extension": (hip_peak, hip_evi), "contact_time_ms": (contact_ms, 0),
           "cadence_spm": (cadence, 0)}

    metrics, flaws, recs, per_usable = [], [], [], {}
    phase = "acceleration" if azimuth_deg < 45 else "max_velocity"
    for key, (val, evi) in raw.items():
        vp = _viewpoint_penalty(azimuth_deg, PLANE[key])
        conf = max(0.0, min(1.0, mean_conf * (1 - vp)))
        band = _band(val, conf)
        usable = conf >= 0.35 and val > 0
        per_usable[key] = usable
        trust = "experimental" if (conf < 0.6 or vp > 0.5) else "trusted"
        metrics.append({"key": key, "measured": band, "unit": UNIT[key],
                        "normalRange": list(NORMAL_RANGE[key]), "comparableAcrossViews": True,
                        "trustStatus": trust})
        lo, hi = NORMAL_RANGE[key]
        if usable and (val < lo or val > hi):
            dev = (lo - val if val < lo else val - hi) / max(hi - lo, 1)
            sev = 3 if dev > 0.5 else 2 if dev > 0.2 else 1
            fid = f"flaw-{key.replace('_', '-')}"
            direction = "below" if val < lo else "above"
            ts = int((frame_indices[evi] if evi < len(frame_indices) else 0) / fps * 1000)
            flaws.append({
                "id": fid, "name": NAMES[key], "phase": phase, "severity": sev,
                "plainExplanation": f"Your {key.replace('_', ' ')} ({val:.0f}{UNIT[key]}) is {direction} the typical {lo:.0f}–{hi:.0f}{UNIT[key]}.",
                "evidence": {"frameTimestampMs": ts,
                             "jointAngles3D": {"knee_drive": round(knee_peak, 1), "hip_extension": round(hip_peak, 1), "trunk_lean": round(trunk_mean, 1)},
                             "measured": band, "normalRange": list(NORMAL_RANGE[key]), "viewpointPenalty": round(vp, 2)},
            })
            recs.append({"flawId": fid, **DRILLS[key]})

    overall = float(np.mean([m["measured"]["confidence"] for m in metrics]))
    nudge = None
    if azimuth_deg > 45:
        nudge = "Film from the side (perpendicular to running direction) for trustworthy joint angles."
    elif fps < 60:
        nudge = "Record at 120fps+ if possible — sprint ground-contact is very fast."

    return {
        "id": f"analysis-{clip_id}", "phase": phase,
        "summary": ("Clean sprint mechanics — nothing flagged this run." if not flaws
                    else f"We found {len(flaws)} thing{'s' if len(flaws) > 1 else ''} to work on."),
        "flaws": flaws, "recommendations": recs, "metrics": metrics,
        "captureQuality": {"overall": round(overall, 2), "fps": fps, "motionBlur": "low",
                           "framing": "full", "perMetricUsable": per_usable,
                           **({"primaryNudge": nudge} if nudge else {})},
        "reconstructionMethod": "2d", "createdAt": datetime.now(timezone.utc).isoformat(),
    }


def analyze_2d_sagittal_stream(frame_iter: Iterable[dict], fps: float,
                               azimuth_deg: float, clip_id: str = "clip",
                               min_frames: int = 8, max_frames: int = 450) -> dict[str, Any]:
    """Memory-lean: consume a frame generator in ONE pass, retaining only scalar
    series (never the keypoint arrays). Raises low_confidence_video if too few
    usable frames survive. Stops after max_frames to bound worst-case latency
    (enough strides for stable peak/gait stats)."""
    knee: list[float] = []; hip: list[float] = []; trunk: list[float] = []
    lank: list[float] = []; rank: list[float] = []; idxs: list[int] = []
    conf_sum = 0.0
    total = 0
    for f in frame_iter:
        total += 1
        if total > max_frames:
            break
        if f.get("excluded"):
            continue
        kd, he, tr, lr, rr, mc = _frame_scalars(_kp(f))
        knee.append(kd); hip.append(he); trunk.append(tr)
        lank.append(lr); rank.append(rr); idxs.append(int(f["frame_index"]))
        conf_sum += mc
    included = len(knee)
    excluded_pct = (total - included) / total if total else 1.0
    if included < min_frames or excluded_pct > 0.60:
        raise ValueError("low_confidence_video")
    mean_conf = conf_sum / len(knee)
    return _assemble(knee, hip, trunk, lank, rank, idxs, fps, mean_conf, azimuth_deg, clip_id)


def analyze_2d_sagittal(frames: list[dict], fps: float, mean_conf: float,
                        azimuth_deg: float, clip_id: str = "clip") -> dict[str, Any]:
    """List-based variant (kept for callers/tests that already hold frames)."""
    knee, hip, trunk, lank, rank, idxs = [], [], [], [], [], []
    for f in frames:
        kd, he, tr, lr, rr, _ = _frame_scalars(_kp(f))
        knee.append(kd); hip.append(he); trunk.append(tr)
        lank.append(lr); rank.append(rr); idxs.append(int(f["frame_index"]))
    return _assemble(knee, hip, trunk, lank, rank, idxs, fps, mean_conf, azimuth_deg, clip_id)
