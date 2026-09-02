"""2D sagittal-plane sprint biomechanics (production path for side/oblique capture).

For a side-on view, sagittal joint angles + temporal metrics can be measured
directly from good 2D keypoints (VideoRun2D-style, ~3-5deg) WITHOUT the fragile
monocular 3D lift. Consumes RTMPose COCO-17 keypoints, emits the @stride/types
AnalysisResult the API/mobile render.

Metrics computed (all from a single side-on view):
  sagittal angles : trunk_lean, knee_drive, hip_extension, knee_flexion, arm_swing
  spatial         : overstride, vertical_oscillation
  temporal        : contact_time_ms, cadence_spm

Gait events use research-validated kinematic definitions (no force plate):
  footstrike — pelvis-relative ankle-height minimum / vertical-velocity
    zero-crossing (FPOSV/FVELV; Fellin et al. 2010, abs err ~22-25 ms vs vGRF);
  toe-off — peak knee extension after footstrike (PKEXT; Fellin et al. 2010,
    abs err ~5 ms vs vGRF; confirmed best kinematic toe-off, Smith 2015).
Angle peaks are EVENT-CONDITIONED: extracted per detected stride (swing window
for knee drive / swing flexion, toe-off window for hip extension) and reported
as the median of per-stride peaks — a whole-clip percentile is only a fallback
and is never certified trusted.

HONEST PROXY DEFINITIONS (these are coaching proxies, not ISB joint angles):
  hip_extension — shoulder-hip-knee interior angle (trunk-thigh), NOT femur vs
    pelvis in an anatomical pelvic frame;
  knee_drive    — thigh segment vs gravity vertical, not an anatomical hip angle;
  arm_swing     — elbow interior angle (arm carry), not shoulder excursion;
  overstride    — ankle-ahead-of-mid-hip at footstrike as % of instantaneous
    hip-ankle length (signed along the running direction when camera motion
    allows the direction to be resolved; magnitude-only otherwise).

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

# Index joints by CANONICAL name, never by a backbone's raw indices — the pose2d
# seam guarantees every frame is in this canonical (COCO-17) layout, so a backbone
# swap can't silently feed the wrong joint (bug B2). CANON_KP == the old COCO-17
# map for the current backbones, so this is behaviour-preserving.
from src.canonical_2d import CANON_KP as KP
from src.biomechanics import _angle_at_joint, _angle_between_vectors

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
    # ── frontal-plane (measurable from a FRONT/BACK view, not side-on) ──
    "knee_valgus": (0.0, 8.0),             # peak knee medial deviation, % of leg length
    "pelvic_drop": (0.0, 10.0),            # peak contralateral hip drop, degrees
}
# Metrics that live in the FRONTAL plane: trustworthy from a front/back view and
# degraded from the side (the inverse of the sagittal metrics). See _viewpoint_penalty.
FRONTAL: set[str] = {"knee_valgus", "pelvic_drop"}
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
    "knee_valgus": (0.0, 40.0),
    "pelvic_drop": (0.0, 45.0),
}

# ── Sprint-phase-specific norms ───────────────────────────────────────────────
# Running mechanics differ by PHASE. The drive/acceleration out of blocks has a
# large, correct forward trunk lean (~40-50°) that would be wrongly flagged
# against the upright max-velocity range (8-22°). We detect the phase from the
# athlete's posture (see _assemble) and, for phase-sensitive metrics, override
# the "healthy" band + plausibility envelope. Metrics not listed for a phase fall
# back to the upright/global values above.
ACCEL_LEAN_THRESH = 28.0  # median trunk lean (deg) above which a moving athlete is in drive/accel
PHASE_NORMAL_RANGE: dict[str, dict[str, tuple[float, float]]] = {
    "acceleration": {"trunk_lean": (35.0, 55.0)},
}
PHASE_PLAUSIBLE: dict[str, dict[str, tuple[float, float]]] = {
    "acceleration": {"trunk_lean": (12.0, 75.0)},
}


def _norm_range(key: str, phase: str) -> tuple[float, float]:
    return PHASE_NORMAL_RANGE.get(phase, {}).get(key, NORMAL_RANGE[key])


def _plausible_range(key: str, phase: str) -> tuple[float, float]:
    return PHASE_PLAUSIBLE.get(phase, {}).get(key, PLAUSIBLE.get(key, (float("-inf"), float("inf"))))


UNIT = {"trunk_lean": "°", "knee_drive": "°", "hip_extension": "°",
        "knee_flexion": "°", "arm_swing": "°", "overstride": "%",
        "vertical_oscillation": "%", "contact_time_ms": "ms", "cadence_spm": "spm",
        "knee_valgus": "%", "pelvic_drop": "°"}
PLANE = {"trunk_lean": "sagittal", "knee_drive": "sagittal", "hip_extension": "sagittal",
         "knee_flexion": "sagittal", "arm_swing": "sagittal", "overstride": "sagittal",
         "vertical_oscillation": "temporal", "contact_time_ms": "temporal", "cadence_spm": "temporal",
         "knee_valgus": "frontal", "pelvic_drop": "frontal"}

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
    "knee_valgus": {"drillId": "drill-lateral-band", "drillName": "Lateral band walks + single-leg balance", "cue": "Drive the knee OVER the middle toe; don't let it cave inward.", "demoAssetId": "demo-lateral-band", "sets": 3, "reps": 12, "rationale": "Strengthens glute-med to stop the knee collapsing inward."},
    "pelvic_drop": {"drillId": "drill-hip-hitch", "drillName": "Single-leg hip hitches", "cue": "Keep your hips level — don't let the free side drop.", "demoAssetId": "demo-hip-hitch", "sets": 3, "reps": 10, "rationale": "Builds hip-abductor control to keep the pelvis level in stance."},
}
NAMES = {"trunk_lean": "Trunk angle off-target", "knee_drive": "Low knee drive",
         "hip_extension": "Limited hip extension", "knee_flexion": "Limited knee flexion",
         "arm_swing": "Arm swing off-target", "overstride": "Overstriding",
         "vertical_oscillation": "Excess vertical bounce", "contact_time_ms": "Long ground contact",
         "cadence_spm": "Cadence off-target", "knee_valgus": "Knee collapsing inward",
         "pelvic_drop": "Hip dropping"}
# short "why it matters" used by the results UI + coach grounding.
WHY = {
    "trunk_lean": "A slight forward lean from the ankles keeps you driving forward; too upright or bent-at-the-waist wastes force.",
    "knee_drive": "Higher knee drive sets up a longer, more powerful stride.",
    "hip_extension": "Finishing the drive behind you is where most of your propulsion comes from (we read this as your trunk-to-thigh opening at toe-off).",
    "knee_flexion": "A well-flexed swing leg shortens the lever so the leg recovers faster.",
    "arm_swing": "Arms driving front-to-back (not across the body) reduce rotational braking (we read this via your elbow angle).",
    "overstride": "Landing your foot ahead of your hips brakes you on every step and loads the knee. This is the #1 efficiency leak.",
    "vertical_oscillation": "Energy spent bouncing up is energy not spent moving forward.",
    "contact_time_ms": "Less time on the ground generally means a springier, faster stride (needs high-fps video to measure well).",
    "cadence_spm": "Quicker, lighter steps usually cut overstriding and braking (needs high-fps video to measure well).",
    "knee_valgus": "A knee that caves inward on landing wastes force and is a leading driver of runner's knee and ACL stress (best seen from front/back).",
    "pelvic_drop": "Hips that drop on the swing side leak energy and overload the stance-leg hip and IT band (best seen from front/back).",
}

# ── Trust tiers (docs/research/angle-agnostic-kinematics.md) ──────────────────
# Trust by variable TYPE, not by azimuth. Tier 1 = angle-robust but frame-rate-
# gated; Tier 2 = sagittal (best side-on, degraded off-axis); Tier 3 = rebinned /
# translation-dependent — narrower trust window than tier 2 (see OVERSTRIDE_VP_MAX).
TIER = {
    "cadence_spm": 1, "contact_time_ms": 1, "vertical_oscillation": 1,
    "trunk_lean": 2, "knee_drive": 2, "hip_extension": 2, "knee_flexion": 2, "arm_swing": 2,
    "knee_valgus": 2, "pelvic_drop": 2,   # tier-2 but FRONTAL-plane (see FRONTAL set)
    "overstride": 3,
}
# Sprint ground contact is ~90 ms; below ~120 fps the timing error swamps the signal
# (30 fps → ±33 ms). Gate on the KEYPOINT sample rate (pose fps), not capture fps —
# pose subsampling also limits temporal resolution. Report capture fps separately.
FPS_TRUST_GATE = 120.0
# Confidence/viewpoint tolerance for a metric to be certified "trusted" rather
# than "experimental". These stay STRICT on purpose: experimental metrics now
# participate in the score (EXPERIMENTAL_FORM_WEIGHT) and surface as focus
# areas (FOCUS_TARGET), so a borderline measurement is never silently dropped —
# which removes the only argument for loosening the badge itself. "Trusted" is
# the app's word to the athlete that we'd stand behind the number; a penalty
# above 0.5 means more than half the plane's signal is corrupted.
TRUST_CONF_MIN = 0.6
TRUST_VP_MAX = 0.5
# Overstride (tier 3) is translation-dependent, so it gets a tighter viewpoint
# cap than tier-2's TRUST_VP_MAX rather than being permanently barred from
# trust: vp = sin(azimuth)² for sagittal metrics, so vp<=0.3 means the camera
# is within ~33° of pure side-on — the actual geometric condition under which
# this measurement is sound. Gated on the RAW keypoint confidence (mean_conf):
# the displayed tier-3 confidence carries a fixed 0.6 translation discount that
# would make TRUST_CONF_MIN unreachable by construction, which is a statement
# about the formula, not the clip. Outside that window it stays "experimental".
OVERSTRIDE_VP_MAX = 0.3
# Perspective/scale corrupt vertical CoM off-axis and it is unmeasured on runners
# (honesty ledger #9) — keep it a candidate, never headline-trusted yet.
CANDIDATE = {"vertical_oscillation"}

# Metrics whose IDEAL reading is zero. For these, 0.0 is the best possible
# result, not a missing measurement.
#
# The plausibility gate reads `val > 0` to catch a metric that never got
# computed, because an unset value defaults to 0.0. That conflates "measured
# zero" with "not measured", and for a lower-is-better metric the two are
# opposite verdicts: an athlete with perfectly tracking knees reads exactly 0.0
# knee valgus and was being marked unmeasurable -- never trusted, never scored.
# Same shape as the band-as-plateau bug in _form_score, where perfect form was
# punished because only the band midpoint scored well.
ZERO_IS_VALID = {"knee_valgus", "pelvic_drop", "overstride"}
# Peak angle metrics that are only meaningful AT a gait event (peak knee drive
# in swing, peak swing flexion, hip extension at toe-off). When stride events
# can't be detected, these fall back to whole-clip percentiles — a legitimate
# descriptive read, but never certified "trusted": a blind percentile can pick
# its peak from a non-running frame (stumble, walk-off, occlusion artifact).
EVENT_ANGLES = {"knee_drive", "knee_flexion", "hip_extension"}

# ── Form-score weights (max points one metric's fault can cost) ───────────────
# Ordered by how much each mechanic actually moves sprint performance:
# propulsion (hip extension, knee drive) > braking (overstride) > posture
# (trunk) > ground timing > recovery/style > frontal stability. A hip-extension
# fault costs ~3x an arm-swing quirk instead of the old equal averaging.
FORM_WEIGHT: dict[str, float] = {
    "hip_extension": 18.0,
    "knee_drive": 16.0,
    "overstride": 14.0,
    "trunk_lean": 12.0,
    "contact_time_ms": 12.0,
    "cadence_spm": 10.0,
    "knee_valgus": 10.0,
    "knee_flexion": 8.0,
    "pelvic_drop": 8.0,
    "arm_swing": 6.0,
    "vertical_oscillation": 6.0,
}
# Penalty curve steepness, in band-half-widths outside the healthy band:
# dev=0.5 → ~28% of the weight, dev=1.5 → ~63%, dev=3+ → ~86-100% (saturates).
FORM_SCORE_DECAY = 1.5
# Experimental (usable but not confident-enough-to-certify) metrics still
# deduct — at half a trusted metric's weight, the same uncertainty discount
# used everywhere else in this module. Excluding them entirely let a single
# clean trusted metric mask a pile of bad experimental ones (e.g. one fine
# cadence reading + a genuinely bad-form clip → ~82). The discount does NOT
# escalate when trusted coverage is thin: uncertainty doesn't shrink because
# it is widespread, and the sparse-coverage caps already stop a thin clip
# from claiming a great score.
EXPERIMENTAL_FORM_WEIGHT = 0.5
# Ceiling on flaws + focus areas surfaced per clip (see _focus_candidates):
# enough targets to build a plan from, few enough to stay a priority list.
FOCUS_TARGET = 5


def _form_score(scorable: list[tuple[str, float, bool]], phase: str) -> int:
    """Running form score, 0-100: start at 100 and deduct per demonstrated fault.

    `scorable` is (metric_key, value, trusted) for USABLE metrics (plausible +
    confident enough to report at all). Scoring rules:
      * Anywhere INSIDE the healthy band deducts nothing — the band is a
        plateau. (The old midpoint-averaging formula rewarded only the band
        MIDPOINT, so an elite ~0% overstride against the 0-12% band scored
        50% — perfect form was mathematically punished on every "lower is
        better" metric.)
      * Outside the band the deduction rises smoothly and saturates at the
        metric's FORM_WEIGHT: weight * (1 - exp(-dev/FORM_SCORE_DECAY)), where
        dev = distance outside the band in band-half-widths.
      * EVERY usable metric scores — trusted at full weight, experimental at
        EXPERIMENTAL_FORM_WEIGHT (uncertainty discount). Excluding
        experimental metrics whenever anything trusted survived let one clean
        trusted reading mask a pile of genuinely bad experimental ones; only
        the CONFIDENCE in a deduction changes, never whether it counts.
      * Sparse-coverage cap: 1 scored metric caps at 80, 2 cap at 90 — a clip
        where almost nothing was measurable can't claim a perfect 100.
    """
    if not scorable:
        return 0

    total = 0.0
    for k, v, trusted in scorable:
        lo, hi = _norm_range(k, phase)
        half = max((hi - lo) / 2.0, 1e-6)
        dev = (lo - v) / half if v < lo else (v - hi) / half if v > hi else 0.0
        if dev <= 0:
            continue
        weight = FORM_WEIGHT.get(k, 8.0) * (1.0 if trusted else EXPERIMENTAL_FORM_WEIGHT)
        total += weight * (1.0 - math.exp(-dev / FORM_SCORE_DECAY))

    cap = 100.0 if len(scorable) >= 3 else 90.0 if len(scorable) == 2 else 80.0
    return int(round(max(0.0, min(cap, 100.0 - total))))


def _focus_candidates(values: dict[str, tuple[float, int]], per_usable: dict[str, bool],
                      flagged_keys: set[str], phase: str, need: int) -> list[tuple[str, str]]:
    """Pick up to `need` focus-area targets from the usable, un-flagged metrics.

    Two honest kinds, in priority order (see the focus-area block in _assemble):
      * "unconfirmed" — outside the healthy band but not certified trusted
        (trusted deviations already raised flaws): a real measured deviation
        we won't state as fact, largest deviation first;
      * "refinement" — inside the band but closest to its edge: not a fault,
        a sharpening candidate, smallest margin first.
    Pure and deterministic; returns [(metric_key, kind)].
    """
    if need <= 0:
        return []
    unconfirmed: list[tuple[float, str]] = []
    refinements: list[tuple[float, str]] = []
    for key, (val, _evi) in values.items():
        if key in flagged_keys or not per_usable.get(key) or val <= 0:
            continue
        lo, hi = _norm_range(key, phase)
        half = max((hi - lo) / 2.0, 1e-6)
        if val < lo or val > hi:
            dev = (lo - val if val < lo else val - hi) / half
            unconfirmed.append((dev, key))
        else:
            margin = min(val - lo, hi - val) / half
            refinements.append((margin, key))
    unconfirmed.sort(key=lambda c: (-c[0], c[1]))
    refinements.sort(key=lambda c: (c[0], c[1]))
    picks = [(k, "unconfirmed") for _, k in unconfirmed] + [(k, "refinement") for _, k in refinements]
    return picks[:need]

_UNIT_SUFFIXES = ("_ms", "_spm")


def _metric_label(key: str) -> str:
    """Human label for a metric key — strips a trailing unit suffix so e.g.
    'contact_time_ms' reads as 'contact time', not 'contact time ms'."""
    base = key
    for suffix in _UNIT_SUFFIXES:
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return base.replace("_", " ")


def _fmt_value(val: float, unit: str) -> str:
    """Thousands-separated number with unit — no space before deg/percent
    (e.g. '18°', '40%'), a space before abbreviations (e.g. '167 ms')."""
    num = f"{val:,.0f}"
    return f"{num}{unit}" if unit in ("°", "%") else f"{num} {unit}"

_VERT_DOWN = np.array([1.0, 0.0])  # image coords are [y, x]; y increases downward
_UP = np.array([-1.0, 0.0])


def _kp(frame: dict) -> np.ndarray:
    k = frame["keypoints"]
    return np.asarray(k) if isinstance(k, list) else k


def _smooth(x: np.ndarray, w: int = 3) -> np.ndarray:
    if len(x) < w:
        return x
    return np.convolve(x, np.ones(w) / w, mode="same")


def _savgol(x: np.ndarray, fps: float = 15.0, p: int = 2) -> np.ndarray:
    """Savitzky-Golay smoothing for per-frame angle series, TIME-based window.

    The window is ~150 ms of signal regardless of sample rate (capped at 9
    taps): a fixed 5-tap window was ~330 ms at pose_fps=15 — a large fraction
    of a sprint swing phase (~250-350 ms), attenuating the very peaks (max
    knee drive, peak swing flexion) the metrics report. ~150 ms kills
    per-frame keypoint jitter while preserving stride peaks at every fps.
    Analysis is a queued job, so a non-causal filter is fine here."""
    n = len(x)
    if n < 5:
        return x
    wl = int(round(fps * 0.15))
    wl = max(3, min(wl, 9, n))
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


# Mediolateral body spans, expressed as a fraction of TORSO LENGTH (shoulder
# midpoint → hip midpoint). Torso is a superoinferior span, so it does not
# foreshorten under camera yaw; a shoulder or hip width does. Dividing one by the
# other is what makes the azimuth estimate depend on camera angle at all.
#
# Population midpoints (biacromial ≈ 0.23·stature, bi-iliac ≈ 0.17·stature,
# torso ≈ 0.29·stature). These set the SCALE of the estimate, not whether it
# responds to the camera — so an imperfect constant biases the angle, it does not
# flatten it. Calibrate against filmed ground truth at known angles.
SHOULDER_TORSO_RATIO = 0.78
HIP_TORSO_RATIO = 0.60


def estimate_azimuth_from_keypoints(k: np.ndarray) -> float | None:
    """Camera yaw from projected body width. 0° = side-on, 90° = head-on.

    Under this convention a mediolateral span (shoulder or hip width) projects as
    `span · sin(azimuth)`, while torso length is superoinferior and is unchanged
    by yaw. Their RATIO therefore carries the angle, and `asin` recovers it.

    Replaces a hip-width / shoulder-width heuristic that could not work. Both of
    those are mediolateral, so both carry the same `sin(azimuth)` factor and it
    CANCELS in the ratio:

        hw_proj / sw_proj = (HW·sin a) / (SW·sin a) = HW / SW

    i.e. the old estimator returned the athlete's bi-iliac / biacromial ratio — an
    anthropometric constant — for every camera position. It pinned azimuth near
    41° on every clip, which made the tier-2 trust gate unreachable by
    construction (`conf = mean_conf · (1 − sin²41°) ≥ 0.6` needs mean_conf ≥ 1.07)
    and therefore prevented ANY joint angle from ever raising a flaw.

    Known confound: a large forward trunk lean foreshortens the torso segment as
    the view goes head-on, which inflates the ratio. The response stays monotonic
    in yaw, so gating still works; the calibration above absorbs the bias.
    """
    ls, rs = k[KP["left_shoulder"]], k[KP["right_shoulder"]]
    lh, rh = k[KP["left_hip"]], k[KP["right_hip"]]
    if min(ls[2], rs[2], lh[2], rh[2]) < 0.3:
        return None

    # keypoints are [y, x, conf]: index 0 = vertical, index 1 = horizontal
    mid_sh = (ls[:2] + rs[:2]) / 2.0
    mid_hp = (lh[:2] + rh[:2]) / 2.0
    torso = float(np.linalg.norm(mid_sh - mid_hp))
    if torso < 1e-4:
        return None

    # Two independent reads of sin(azimuth); mean them so one bad keypoint pair
    # (an occluded far shoulder, say) cannot swing the estimate on its own.
    sins = [
        abs(float(rs[1] - ls[1])) / (torso * SHOULDER_TORSO_RATIO),
        abs(float(rh[1] - lh[1])) / (torso * HIP_TORSO_RATIO),
    ]
    s = float(np.mean([min(1.0, max(0.0, v)) for v in sins]))
    return round(math.degrees(math.asin(min(1.0, max(0.0, s)))), 1)


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

    # ── frontal-plane scalars (meaningful from a FRONT/BACK view) ──────────────
    lh, rh = k[KP["left_hip"], :2], k[KP["right_hip"], :2]
    lk, rk = k[KP["left_knee"], :2], k[KP["right_knee"], :2]
    la, ra = k[KP["left_ankle"], :2], k[KP["right_ankle"], :2]

    def _valgus(hp, kn, an) -> float:
        # horizontal (x) deviation of the knee from the straight hip→ankle line,
        # as % of leg length — a knee caving toward the midline in a front view.
        dy = float(an[0] - hp[0])
        if abs(dy) < 1e-4:
            return 0.0
        t = (float(kn[0]) - float(hp[0])) / dy
        exp_x = float(hp[1]) + t * float(an[1] - hp[1])
        ll = float(np.linalg.norm(an - hp)) or 1e-6
        return abs(float(kn[1]) - exp_x) / ll * 100.0

    knee_valgus = max(_valgus(lh, lk, la), _valgus(rh, rk, ra))
    # pelvic drop: tilt of the hip line off horizontal (deg); level pelvis = 0.
    _hv = rh - lh  # [dy, dx]
    pelvic_drop = math.degrees(math.atan2(abs(float(_hv[0])), abs(float(_hv[1])) + 1e-6))

    return {
        # per-side knee interior angle — feeds PKEXT toe-off event detection
        "l_knee": _angle_at_joint(lh, lk, la),
        "r_knee": _angle_at_joint(rh, rk, ra),
        # mid-hip horizontal position — resolves running direction (overstride sign)
        "hip_x": float(mid_hp[1]),
        "knee_valgus": knee_valgus,
        "pelvic_drop": pelvic_drop,
        "knee_drive": _angle_between_vectors(knee - hip, vert_down),   # thigh vs gravity vertical
        "hip_ext": _angle_at_joint(sh, hip, knee),                     # shoulder-hip-knee, peak
        "knee_flex": _angle_at_joint(hip, knee, ank),                  # knee joint angle, min=peak flexion
        "elbow": _angle_at_joint(a_sh, a_el, a_wr),                    # arm swing
        "trunk": _angle_between_vectors(mid_sh - mid_hp, up),
        "hip_y": hip_vert,
        "torso_len": float(np.linalg.norm(mid_sh - mid_hp)) or 1e-6,
        # keypoints are [y, x]: index 1 = horizontal (overstride), index 0 = vertical (contact)
        "ank_x_rel": float(ank[1] - mid_hp[1]),                        # foot horizontal vs hip (overstride)
        "ank_y_rel": float(ank[0] - mid_hp[0]),                        # foot vertical vs hip (contact)
        "leg_len": leg_len,
        "conf": float(np.mean(k[:, 2])),
    }


def _contact_positions(ank_y_rel: np.ndarray, fps: float = 15.0) -> list[int]:
    """Footstrike frame indices — local maxima of the pelvis-relative ankle
    height (foot lowest in image). This is the kinematic FPOSV/FVELV event
    (ankle vertical-position minimum == vertical-velocity zero-crossing), one
    of the two footstrike definitions validated against force plates for
    running (Fellin et al. 2010, abs err ~22-25 ms). Refractory between
    same-foot strikes is TIME-based (~140 ms) instead of a fixed frame count."""
    y = _smooth(ank_y_rel)
    if len(y) < 3 or y.max() - y.min() < 1e-3:
        return []
    thr = y.min() + (y.max() - y.min()) * 0.7
    min_gap = max(2, int(round(fps * 0.14)))
    out, refractory = [], 0
    for i in range(1, len(y) - 1):
        if refractory <= 0 and y[i] >= thr and y[i] >= y[i - 1] and y[i] >= y[i + 1]:
            out.append(i)
            refractory = min_gap
        refractory -= 1
    return out


def _toe_off_after(knee: np.ndarray, strike: int, fps: float) -> int | None:
    """Toe-off = first PEAK KNEE EXTENSION (local max of the interior knee
    angle) after a footstrike — the PKEXT method, the most accurate kinematic
    toe-off event vs force plates (abs err ~5 ms; Fellin et al. 2010).
    Search window is 400 ms, the plausibility ceiling for running contact."""
    end = min(len(knee) - 1, strike + max(2, int(round(fps * 0.40))))
    for i in range(strike + 1, end):
        if knee[i] >= knee[i - 1] and knee[i] > knee[i + 1]:
            return i
    return None


def _gait(lank: np.ndarray, rank: np.ndarray, fps: float,
          lknee: np.ndarray | None = None, rknee: np.ndarray | None = None) -> tuple[float, float]:
    """Contact time + cadence from pose-rate ankle-height signals.

    Contact = footstrike (ankle-height local max) → toe-off (peak knee
    extension), both research-validated kinematic events — replacing the old
    arbitrary "% of signal range" run-length threshold. Falls back to the
    threshold method when a per-side knee-angle series isn't available."""
    strikes: list[int] = []
    contacts_ms: list[float] = []
    for rel, knee in ((lank, lknee), (rank, rknee)):
        rs = _smooth(rel)
        if len(rs) == 0 or rs.max() - rs.min() < 1e-3:
            continue
        side_strikes = _contact_positions(rel, fps)
        strikes += side_strikes
        ks = _smooth(np.asarray(knee, dtype=float)) if knee is not None and len(knee) == len(rel) else None
        side_contacts: list[float] = []
        if ks is not None and side_strikes:
            for s in side_strikes:
                to = _toe_off_after(ks, s, fps)
                if to is not None:
                    side_contacts.append((to - s) / fps * 1000.0)
        if not side_contacts:
            # Graceful degradation: no PKEXT toe-off found (noisy/short knee
            # series) → legacy threshold run-lengths rather than losing contact
            # time entirely. A downgrade, never an erasure.
            thr = rs.min() + (rs.max() - rs.min()) * 0.6
            run = 0
            for v in rs:
                if v >= thr:
                    run += 1
                else:
                    if run >= 1:
                        side_contacts.append(run / fps * 1000.0)
                    run = 0
        contacts_ms += side_contacts
    strikes.sort()
    intervals = [(strikes[i] - strikes[i - 1]) / fps for i in range(1, len(strikes))]
    intervals = [d for d in intervals if d > 0.5 / fps]
    cadence = 60.0 / float(np.mean(intervals)) if intervals else 0.0
    # median, not mean: one missed toe-off (occlusion) must not drag the value.
    # Same sanity bound as _gait_signal: a broken/flat signal (or a spurious
    # late toe-off match) can produce a run far outside human stance-phase
    # timing — discard rather than report it as a real contact time.
    plo_ms, phi_ms = PLAUSIBLE["contact_time_ms"]
    sane_contacts = [c for c in contacts_ms if plo_ms <= c <= phi_ms]
    contact_ms = float(np.median(sane_contacts)) if sane_contacts else 0.0
    return round(contact_ms, 1), round(cadence, 1)


def _gait_signal(lank_y: np.ndarray, rank_y: np.ndarray, fps: float) -> tuple[float, float]:
    """Contact-time + cadence from a FULL-fps ankle-height signal (dual-rate).

    Same footstrike model as _gait (foot lowest in the image = local max of ankle
    y), but the smoothing window and inter-strike refractory scale with `fps`, so
    it works at 30/60/120/240 fps and gives cadence/contact-time the temporal
    resolution the 15fps pose sampling can't. Fed a per-frame ankle-y signal
    tracked by optical flow between pose keyframes."""
    sw = max(3, int(round(fps * 0.05)))          # ~50 ms smoothing
    refractory = max(2, int(round(fps * 0.14)))   # ~140 ms min between same-foot strikes
    min_run = max(1, int(round(fps * 0.04)))      # runs <40 ms are noise, not stance
    strikes: list[int] = []
    contact_runs: list[int] = []
    for y in (lank_y, rank_y):
        y = np.asarray(y, dtype=float)
        if len(y) < 3:
            continue
        ys = _smooth(y, sw)
        rng = float(ys.max() - ys.min())
        if rng < 1e-3:
            continue
        strike_thr = float(ys.min() + rng * 0.7)
        contact_thr = float(ys.min() + rng * 0.6)
        last = -(10 ** 9)
        run = 0
        for i in range(len(ys)):
            v = float(ys[i])
            if v >= contact_thr:
                run += 1
            else:
                if run >= min_run:
                    contact_runs.append(run)
                run = 0
            if 0 < i < len(ys) - 1 and (i - last) > refractory and v >= strike_thr and v >= ys[i - 1] and v >= ys[i + 1]:
                strikes.append(i)
                last = i
        if run >= min_run:
            contact_runs.append(run)
    strikes.sort()
    intervals = [(strikes[i] - strikes[i - 1]) / fps for i in range(1, len(strikes))]
    intervals = [d for d in intervals if d > 0.5 / fps]
    cadence = 60.0 / float(np.mean(intervals)) if intervals else 0.0
    # median, not mean: partial runs at the clip edges must not skew the value.
    # A heavily motion-blurred clip can break optical-flow tracking outright —
    # the ankle-y signal gets stuck above contact_thr instead of oscillating,
    # producing one run spanning most of the clip (thousands of ms). That is a
    # broken signal, not a slow stance phase: no human stance phase is anywhere
    # near PLAUSIBLE bounds' upper end, so a run outside them is discarded
    # rather than reported as a physically-impossible contact time. If nothing
    # survives, contact_ms falls through as 0 and the caller's existing
    # pose-rate fallback (`_gait`) takes over instead of a garbage value.
    plo_ms, phi_ms = PLAUSIBLE["contact_time_ms"]
    sane_runs = [r for r in contact_runs if plo_ms <= (r / fps * 1000) <= phi_ms]
    contact_ms = float(np.median(sane_runs)) / fps * 1000 if sane_runs else 0.0
    return round(contact_ms, 1), round(cadence, 1)


def _viewpoint_penalty(azimuth_deg: float, plane: str) -> float:
    a = math.radians(abs(azimuth_deg) % 180)
    if plane == "frontal":
        # Frontal metrics (knee valgus, hip drop) are the INVERSE of sagittal:
        # trustworthy from a front/back view (azimuth→90°), degraded from the side.
        return min(1.0, math.cos(a) ** 2)
    out = math.sin(a) ** 2
    return min(1.0, out) if plane == "sagittal" else min(1.0, out * 0.25)


def _band(value: float, conf: float) -> dict[str, float]:
    span = max(abs(value), 1.0)
    half = span * (0.04 + 0.6 * (1 - conf))
    return {"value": round(value, 1), "low": round(value - half, 1),
            "high": round(value + half, 1), "confidence": round(conf, 2)}


def _assemble(S: dict[str, list[float]], idxs: list[int], pose_fps: float,
              mean_conf: float, azimuth_deg: float, clip_id: str,
              capture_fps: float | None = None, source_fps: float | None = None,
              timing_signal: list | None = None, timing_fps: float | None = None,
              dropped_pct: float = 0.0, vp_override: float | None = None,
              recon_conf: float = 1.0) -> dict[str, Any]:
    """Assemble metrics. `pose_fps` = keypoint sample rate (gait timing);
    `capture_fps` = phone capture rate (reported quality + nudges);
    `source_fps` = video container fps (flaw evidence timestamps).

    `vp_override` / `recon_conf` serve the virtual-camera path (see
    src/virtual_camera.py). When metrics are read from a synthetic on-axis
    camera the viewpoint penalty is genuinely zero — we chose the camera — so
    `vp_override=0.0` states that honestly. But a monocular 3D reconstruction
    has its OWN uncertainty, which the azimuth term never modelled, so it rides
    separately in `recon_conf`. Keeping them as two terms is deliberate:
    collapsing them would let an ideal viewpoint launder an unvalidated
    reconstruction into a `trusted` badge."""
    a = {k: np.array(v) for k, v in S.items()}
    # Kill per-frame keypoint jitter on the angle series BEFORE peak extraction
    # — raw jitter inflates the per-stride peaks the metrics report. Window is
    # time-based (~150 ms at any pose fps), see _savgol.
    for _ak in ("knee_drive", "hip_ext", "knee_flex", "elbow", "trunk"):
        a[_ak] = _savgol(a[_ak], pose_fps)
    cap_fps = float(capture_fps if capture_fps is not None else pose_fps)
    src_fps = float(source_fps if source_fps is not None else pose_fps)
    _leg = max(float(np.median(a["leg_len"])), 1e-6)

    # ── Gait events on the near-side series (validated kinematic definitions) ──
    # footstrike = ankle-height local max (FPOSV/FVELV, Fellin 2010);
    # toe-off = first peak knee extension after it (PKEXT, Fellin 2010);
    # swing window = toe-off → next footstrike. These anchor BOTH the temporal
    # metrics and the angle peaks to actual strides.
    contacts = _contact_positions(a["ank_y_rel"], pose_fps)
    _knee_series = _smooth(a["knee_flex"])
    toe_offs = [t for t in (_toe_off_after(_knee_series, s, pose_fps) for s in contacts)
                if t is not None]
    swings: list[tuple[int, int]] = []
    for _to in toe_offs:
        _nxt = next((s for s in contacts if s > _to), None)
        if _nxt is not None and _nxt - _to >= 2:
            swings.append((_to, _nxt))
    _to_pad = max(1, int(round(pose_fps * 0.08)))  # ±80 ms window around toe-off
    n_frames = len(a["ank_y_rel"])
    to_windows = [(max(0, t - _to_pad), min(n_frames - 1, t + _to_pad)) for t in toe_offs]
    event_conditioned = len(contacts) >= 2 and len(swings) >= 1 and len(to_windows) >= 1

    # ── Overstride at footstrike: signed along the running direction ──────────
    # Direction from mid-hip drift across the clip (static camera). A tracking
    # camera keeps the runner centered (no drift) → fall back to magnitude-only.
    # NO ceiling clamp: an implausible value must reach the plausibility gate
    # as-is and be reported "couldn't measure", not silently pinned to 40%
    # (the baseline found the clamp saturated on 100% of clips, making the
    # metric a non-signal that still flagged "Overstriding" everywhere).
    overstride_pct = 0.0
    if contacts:
        hip_x = a.get("hip_x")
        direction = 0.0
        if hip_x is not None and len(hip_x) >= 8:
            _drift = float(np.median(hip_x[-4:]) - np.median(hip_x[:4]))
            if abs(_drift) > 0.3 * _leg:
                direction = 1.0 if _drift > 0 else -1.0
        if direction != 0.0:
            os_vals = [max(0.0, direction * a["ank_x_rel"][i]) / max(a["leg_len"][i], 1e-6)
                       for i in contacts]
        else:
            os_vals = [abs(a["ank_x_rel"][i]) / max(a["leg_len"][i], 1e-6) for i in contacts]
        overstride_pct = float(np.median(os_vals)) * 100.0
    # NO ceiling clamp (same reasoning as overstride: the baseline found 25%
    # saturation on every clip) — the plausibility gate owns implausible values.
    # Vertical oscillation is the athlete's BOUNCE, which is a per-stride
    # wobble, not the total travel of the hip across the frame. Measuring the
    # raw range conflates three things: real bounce, the operator panning, and
    # the athlete traversing the shot. Measured across all nine test clips the
    # raw version returned 111%, 157%, 454% and 769% of torso length against a
    # 4-11% healthy band -- it failed the physical envelope on 6 of 7 clips it
    # ran on, so the metric was effectively dead on real footage.
    #
    # Detrending against a stride-length moving average removes the slow
    # component (pan + traversal) and leaves the fast one (bounce). It is not a
    # substitute for real camera-motion compensation from the gyro, which is
    # still the right fix; it is the part that can be done without it.
    _hip_v = a["hip_y"]
    _stride_w = max(3, int(round(pose_fps * 0.42)))     # ~1 stride at sprint cadence
    if len(_hip_v) > _stride_w:
        _trend = _smooth(_hip_v, _stride_w)
        _bounce = _hip_v - _trend
        # trim the convolution edges, which are zero-padded and not real signal
        _e = _stride_w // 2
        _bounce = _bounce[_e:-_e] if len(_bounce) > 2 * _e else _bounce
    else:
        _bounce = _hip_v - float(np.mean(_hip_v))
    vo_pct = float(np.percentile(_bounce, 97.5) - np.percentile(_bounce, 2.5)) \
        / max(float(np.median(a["torso_len"])), 1e-6) * 100.0

    # ── Static-subject guard (the "guard" half of the P0 fix) ──────────────────
    # A running subject's near ankle swings strongly in image-y each stride; a
    # tracker that latched onto a standing bystander barely moves. If vertical
    # ankle travel (as a fraction of leg length) is below a floor, the locked
    # target is almost certainly not the runner — so we refuse to raise any
    # authoritative flaw from it and say so, rather than emitting a low-economy
    # result full of "experimental" numbers that looks like a real (bad) run.
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
        # frontal-plane peaks (trusted from a front/back view; see FRONTAL / _viewpoint_penalty)
        "knee_valgus": (float(np.percentile(a["knee_valgus"], 90)), int(np.argmax(a["knee_valgus"]))),
        "pelvic_drop": (float(np.percentile(a["pelvic_drop"], 90)), int(np.argmax(a["pelvic_drop"]))),
    }

    # ── Event-conditioned angle peaks (the science fix for blind percentiles) ──
    # A whole-clip p95 can pick its "peak" from a stumble, a walk-off segment,
    # or an occlusion artifact. When stride events are detected, each peak is
    # instead extracted WHERE it is biomechanically defined — knee drive and
    # swing flexion inside a swing window, hip extension at toe-off — and the
    # reported value is the MEDIAN of per-stride peaks (robust across strides).
    # A stride whose peak violates the physical envelope marks the metric
    # suspect: the value stays robust but is never certified trusted.
    event_suspect: set[str] = set()
    if event_conditioned:
        def _per_stride(series: np.ndarray, windows: list[tuple[int, int]],
                        take_min: bool = False) -> tuple[float, int, list[float]]:
            peaks: list[tuple[float, int]] = []
            for b, e in windows:
                seg = series[b:e + 1]
                if len(seg) == 0:
                    continue
                j = int(np.argmin(seg)) if take_min else int(np.argmax(seg))
                peaks.append((float(seg[j]), b + j))
            med = float(np.median([p[0] for p in peaks]))
            v, i = min(peaks, key=lambda p: abs(p[0] - med))
            return v, i, [p[0] for p in peaks]

        for _key, _series, _wins, _take_min in (
            ("knee_drive", a["knee_drive"], swings, False),
            ("knee_flexion", a["knee_flex"], swings, True),
            ("hip_extension", a["hip_ext"], to_windows, False),
        ):
            _v, _i, _all = _per_stride(_series, _wins, _take_min)
            values[_key] = (_v, _i)
            _plo, _phi = PLAUSIBLE[_key]
            # Suspect if any stride-window peak violates the physical envelope,
            # OR if a non-trivial fraction of the whole series does (keypoint
            # corruption near the windows is still corruption — the median stays
            # robust, the trusted badge does not survive the evidence).
            _frac_bad = float(np.mean((_series < _plo) | (_series > _phi)))
            if _frac_bad > 0.02 or any(not (_plo <= p <= _phi) for p in _all):
                event_suspect.add(_key)
    # Dual-rate timing (fixes B1): if a FULL-source-fps ankle signal is available
    # (LK optical flow between pose keyframes), compute contact-time + cadence from
    # it and let the temporal trust gate see the REAL foot-sample rate. Otherwise
    # timing rides the 15fps pose rate and can never clear FPS_TRUST_GATE (=120).
    #
    # Graceful degradation: a flat or broken flow signal yields 0s — that must
    # DOWNGRADE to the pose-rate estimate (with the trust gate seeing the honest,
    # lower sample rate for that quantity), never report "no cadence" for a clip
    # whose pose series shows clear strides. Per-key fps so a mixed outcome
    # (signal cadence + pose contact) is gated honestly per metric.
    pose_contact, pose_cadence = _gait(a["l_rel"], a["r_rel"], pose_fps,
                                       a.get("l_knee"), a.get("r_knee"))
    pose_temporal = min(cap_fps, pose_fps)  # temporal trust needs high capture rate AND dense keypoints
    temporal_fps_by_key: dict[str, float] = {}
    if timing_signal is not None and timing_fps and len(timing_signal) >= 8:
        _ts = np.asarray(timing_signal, dtype=float)  # cols: frame_index, lank_y, rank_y
        contact_ms, cadence = _gait_signal(_ts[:, 1], _ts[:, 2], float(timing_fps))
        temporal_fps_by_key["contact_time_ms"] = float(timing_fps)
        temporal_fps_by_key["cadence_spm"] = float(timing_fps)
        if contact_ms <= 0 and pose_contact > 0:
            contact_ms = pose_contact
            temporal_fps_by_key["contact_time_ms"] = pose_temporal
        if cadence <= 0 and pose_cadence > 0:
            cadence = pose_cadence
            temporal_fps_by_key["cadence_spm"] = pose_temporal
    else:
        contact_ms, cadence = pose_contact, pose_cadence
    values["contact_time_ms"] = (contact_ms, 0)
    values["cadence_spm"] = (cadence, 0)

    # Robust fallback statistics: a primary peak percentile can be shot outside
    # the physical envelope by a handful of corrupted frames (occlusion, a
    # momentary keypoint swap). Before declaring such a metric unmeasurable,
    # retry with a more outlier-resistant statistic — a salvaged read is always
    # demoted to experimental (the primary read DID fail), but it participates
    # in the score and focus areas instead of silently vanishing.
    alt_values: dict[str, float] = {
        "knee_drive": float(np.percentile(a["knee_drive"], 85)),
        "hip_extension": float(np.percentile(a["hip_ext"], 85)),
        "knee_flexion": float(np.percentile(a["knee_flex"], 15)),
        "knee_valgus": float(np.percentile(a["knee_valgus"], 75)),
        "pelvic_drop": float(np.percentile(a["pelvic_drop"], 75)),
        "vertical_oscillation": round(float(
            (np.percentile(a["hip_y"], 97.5) - np.percentile(a["hip_y"], 2.5))
            / max(float(np.median(a["torso_len"])), 1e-6)) * 100.0, 1),
    }

    metrics, flaws, recs, per_usable, vp_by_key = [], [], [], {}, {}
    # Sprint PHASE from the athlete's posture, not the camera azimuth: a moving
    # athlete with a large forward trunk lean is driving/accelerating; a low lean
    # is upright max-velocity; a non-moving subject is in no running phase.
    trunk_val = values["trunk_lean"][0]
    if not moving_subject:
        phase = "static"
    elif trunk_val >= ACCEL_LEAN_THRESH:
        phase = "acceleration"
    else:
        phase = "max_velocity"
    # Reconstruction uncertainty multiplies every tier: it is a property of the
    # skeleton we measured, independent of where the camera stood.
    eff_conf = mean_conf * recon_conf
    for key, (val, evi) in values.items():
        tier = TIER.get(key, 2)
        if tier == 1:
            # angle-robust → NO viewpoint penalty; trust gated on the ACTUAL
            # sample rate that produced this quantity (per-key: a pose-rate
            # fallback must not inherit the flow signal's rate).
            vp = 0.0
            conf = eff_conf
            t_fps = temporal_fps_by_key.get(key, pose_temporal)
            trust = "trusted" if (conf >= TRUST_CONF_MIN and t_fps >= FPS_TRUST_GATE and key not in CANDIDATE) else "experimental"
        elif tier == 3:
            # rebinned / translation-dependent → trusted only from a near-pure
            # side view with confident keypoints (see OVERSTRIDE_VP_MAX), never
            # from an off-axis one.
            vp = _viewpoint_penalty(azimuth_deg, "sagittal") if vp_override is None else vp_override
            conf = eff_conf * (1 - vp) * 0.6
            trust = "trusted" if (eff_conf >= TRUST_CONF_MIN and vp <= OVERSTRIDE_VP_MAX) else "experimental"
        else:
            # Tier 2 → best in its own plane, degraded (not zeroed) off-axis. Sagittal
            # metrics trust a SIDE view; frontal metrics (valgus, hip drop) trust a
            # FRONT/BACK view — the inverse penalty, so every angle yields some trusted
            # feedback.
            plane = "frontal" if key in FRONTAL else "sagittal"
            vp = _viewpoint_penalty(azimuth_deg, plane) if vp_override is None else vp_override
            conf = eff_conf * (1 - vp)
            trust = "trusted" if (conf >= TRUST_CONF_MIN and vp <= TRUST_VP_MAX) else "experimental"
        # Event-anchoring gate for peak angles: a peak not tied to a detected
        # stride event (no events found), or drawn from strides with envelope
        # violations, is a descriptive read — reported, scored (discounted),
        # but never certified trusted.
        if key in EVENT_ANGLES and (not event_conditioned or key in event_suspect):
            trust = "experimental"
        conf = max(0.0, min(1.0, conf))
        # Plausibility backstop: a value outside the physical envelope is a failed
        # measurement (off-axis perspective, static-bystander lock, sub-Nyquist
        # timing) — demote it to experimental so it is never shown as trusted.
        # Before dropping the metric entirely, try the robust fallback statistic
        # (alt_values): if the outlier-resistant read IS physically sane, the
        # primary was corrupted by a few bad frames, not unmeasurable — report
        # the salvaged value as experimental rather than losing the metric.
        plo, phi = _plausible_range(key, phase)
        plausible = (plo <= val <= phi) and (val > 0 or key in ZERO_IS_VALID)
        if not plausible:
            alt = alt_values.get(key)
            if alt is not None and alt > 0 and plo <= alt <= phi:
                val = alt
                values[key] = (val, evi)  # keep score/focus-area consumers consistent
                plausible = True
            trust = "experimental"
        band = _band(val, conf)
        usable = conf >= 0.35 and plausible
        per_usable[key] = usable
        vp_by_key[key] = vp
        metrics.append({"key": key, "measured": band, "unit": UNIT[key],
                        "normalRange": list(_norm_range(key, phase)), "comparableAcrossViews": True,
                        "trustStatus": trust, "tier": tier})
        lo, hi = _norm_range(key, phase)
        # Only a TRUSTED, plausible metric may raise an authoritative flaw +
        # drill. Experimental/descriptive readings are never flagged as faults
        # — that is the honesty fix for the "garbage wearing a trusted badge /
        # false-flaw every clip" failures found in the baseline — but they are
        # no longer silently dropped either: usable experimental deviations
        # surface as hedged FOCUS AREAS below, and deduct (discounted) from
        # the form score. A non-moving (static-lock) subject never raises a
        # flaw at all.
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
                "plainExplanation": f"{WHY[key]} Your {_metric_label(key)} is {direction} typical — {_fmt_value(val, UNIT[key])} vs. {_fmt_value(lo, UNIT[key])}–{_fmt_value(hi, UNIT[key])}.",
                "evidence": {"frameTimestampMs": ts,
                             "jointAngles3D": {"knee_drive": round(values['knee_drive'][0], 1), "hip_extension": round(values['hip_extension'][0], 1), "trunk_lean": round(values['trunk_lean'][0], 1)},
                             "measured": band, "normalRange": list(_norm_range(key, phase)), "viewpointPenalty": round(vp, 2)},
            })
            recs.append({"flawId": fid, **DRILLS[key]})

    # ── Focus areas: honest secondary targets, NOT flaws ──────────────────────
    # A plan needs targets even when few authoritative faults survive the trust
    # gate, but inventing flaws (or loosening the gate) would spend the app's
    # honesty to get them. Instead, a separate channel with hedged copy:
    # experimental out-of-band deviations first ("unconfirmed" — real readings
    # we won't state as fact), then in-band values nearest their band edge
    # ("refinement"). Flaw + focus-area count is capped at FOCUS_TARGET; each
    # carries its drill inline so the coach/plan surfaces can use it WITHOUT
    # entering the drill-suggestion approval pipeline (suggestions stay
    # reserved for authoritative faults).
    focus_areas: list[dict] = []
    if moving_subject:
        flagged_keys = {f["id"][len("flaw-"):].replace('-', '_') for f in flaws}
        for key, kind in _focus_candidates(values, per_usable, flagged_keys, phase,
                                           FOCUS_TARGET - len(flaws)):
            val, evi = values[key]
            lo, hi = _norm_range(key, phase)
            frame_i = idxs[evi] if evi < len(idxs) else 0
            band = next(m["measured"] for m in metrics if m["key"] == key)
            if kind == "unconfirmed":
                direction = "below" if val < lo else "above"
                explanation = (
                    f"{WHY[key]} This clip reads your {_metric_label(key)} {direction} typical — "
                    f"{_fmt_value(val, UNIT[key])} vs. {_fmt_value(lo, UNIT[key])}–{_fmt_value(hi, UNIT[key])} — "
                    "but the capture wasn't clean enough to call it a fault. Worth confirming on a re-film."
                )
            else:
                explanation = (
                    f"{WHY[key]} Your {_metric_label(key)} is inside the healthy range but close to the edge — "
                    f"{_fmt_value(val, UNIT[key])} vs. {_fmt_value(lo, UNIT[key])}–{_fmt_value(hi, UNIT[key])}. "
                    "Not a fault — a sharpening candidate."
                )
            focus_areas.append({
                "id": f"focus-{key.replace('_', '-')}", "key": key, "name": NAMES[key],
                "kind": kind, "plainExplanation": explanation,
                "evidence": {"frameTimestampMs": int(frame_i / max(src_fps, 1e-6) * 1000),
                             "measured": band, "normalRange": [lo, hi],
                             "viewpointPenalty": round(vp_by_key.get(key, 0.0), 2)},
                **({"drill": dict(DRILLS[key])} if key in DRILLS else {}),
            })

    # Running form score: deduction-based composite (see _form_score). Usable =
    # plausible + confident. Every usable metric scores — trusted at full
    # weight, experimental at EXPERIMENTAL_FORM_WEIGHT — so thin trust
    # coverage can no longer hide real faults behind a clean trusted metric.
    scorable = [
        (m["key"], m["measured"]["value"], m["trustStatus"] == "trusted")
        for m in metrics
        if per_usable[m["key"]] and m["measured"]["value"] > 0
    ]
    economy = _form_score(scorable, phase)

    overall = float(np.mean([m["measured"]["confidence"] for m in metrics]))
    nudge = None
    if not moving_subject:
        nudge = "Couldn't lock onto a clearly running subject — make sure the runner is centered (or brush to select them) and moving across the frame."
    elif dropped_pct > 0.5:
        nudge = "The runner was hard to track for much of this clip — keep them in frame, and brush-select them to lock on."
    elif azimuth_deg > 45:
        nudge = "Film from the side (perpendicular to running direction) for trustworthy joint angles."
    elif cap_fps < 60:
        nudge = "Record at 120fps+ for accurate ground-contact and cadence."

    if not moving_subject:
        summary = f"Couldn't get a clear read on a running subject in this clip. Form score {economy}/100."
    elif not flaws:
        summary = f"Clean mechanics — nothing flagged. Form score {economy}/100."
    else:
        summary = f"{len(flaws)} thing{'s' if len(flaws) > 1 else ''} to work on. Form score {economy}/100."

    return {
        "id": f"analysis-{clip_id}", "phase": phase, "economyScore": economy,
        "summary": summary,
        "flaws": flaws, "recommendations": recs, "metrics": metrics,
        "focusAreas": focus_areas,
        "captureQuality": {"overall": round(overall, 2), "fps": round(cap_fps, 1),
                           "poseFps": round(pose_fps, 1), "motionBlur": "low",
                           "framing": "full", "perMetricUsable": per_usable,
                           "cameraAzimuthDeg": round(azimuth_deg, 1),
                           "subjectMotion": subject_motion, "movingSubject": moving_subject,
                           "strideEvents": len(contacts), "eventConditioned": event_conditioned,
                           "droppedFramePct": round(dropped_pct, 2),
                           **({"primaryNudge": nudge} if nudge else {})},
        "reconstructionMethod": "2d", "createdAt": datetime.now(timezone.utc).isoformat(),
    }


_KEYS = ["knee_drive", "hip_ext", "knee_flex", "elbow", "trunk", "hip_y",
         "torso_len", "ank_x_rel", "ank_y_rel", "leg_len", "conf",
         "knee_valgus", "pelvic_drop", "l_knee", "r_knee", "hip_x"]


def _collect_scalars(frame_iter: Iterable[dict], azimuth_deg: float,
                     min_frames: int = 8, max_frames: int = 450,
                     overlay_out: list | None = None, src_fps: float = 15.0,
                     image_down: tuple[float, float] | None = None,
                     estimate_azimuth: bool = True) -> tuple[dict, list, float, float, float]:
    """Consume a frame stream once, reducing it to scalar series.

    Extracted from `analyze_2d_sagittal_stream` so a caller can collect from
    MORE THAN ONE view of the same clip and feed a single `_assemble`. The
    virtual-camera path (src/virtual_camera.py) needs exactly that: sagittal
    scalars from a synthetic side camera and frontal scalars from a synthetic
    front camera, scored together as one athlete rather than merged after the
    fact — flaws, focus areas and the form score are all derived from the whole
    metric set inside `_assemble`, so splitting that would mean duplicating it.

    Returns (S, idxs, mean_conf, use_az, excluded_pct). Behaviour is unchanged
    from the original inline loop.
    """
    vert_down, up = resolve_image_axes(image_down)

    S: dict[str, list[float]] = {k: [] for k in _KEYS}
    S["l_rel"] = []; S["r_rel"] = []
    idxs: list[int] = []
    az_samples: list[float] = []
    total = 0
    truncated = False
    for f in frame_iter:
        total += 1
        if total > max_frames:
            # Say so. Silently analysing the first N seconds of a longer clip
            # and reporting on it as though it were the whole run is the kind of
            # omission a user cannot detect and would not forgive.
            truncated = True
            break
        if f.get("excluded"):
            continue
        k = _kp(f)
        sc = _frame_scalars(k, vert_down, up)
        for kk in _KEYS:
            S[kk].append(sc[kk])
        # per-side ankle HEIGHT vs hip for gait (index 0 = image y; foot plant = local max)
        hy = (k[KP["left_hip"], 0] + k[KP["right_hip"], 0]) / 2
        S["l_rel"].append(float(k[KP["left_ankle"], 0] - hy))
        S["r_rel"].append(float(k[KP["right_ankle"], 0] - hy))
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
    # Fail ONLY when there is genuinely nothing to analyze. A high excluded
    # fraction used to hard-fail the whole clip even with plenty of good frames
    # left (e.g. the tracker losing then re-finding the athlete) — now the
    # usable frames are analyzed, the dropped fraction is reported in
    # captureQuality, and per-metric trust gating handles the uncertainty.
    if included < min_frames:
        raise ValueError("low_confidence_video")
    mean_conf = float(np.mean(S["conf"]))
    # Prefer keypoint-estimated azimuth over the static default when available.
    # The hip/shoulder-width heuristic is UNSTABLE frame-to-frame (the baseline
    # measured 33° vs 0° on the same clip depending on the tracked person), so:
    # median for the estimate, and when the spread is wide (IQR > 25°) take the
    # 75th percentile instead — a conservatively HIGHER azimuth that demotes
    # sagittal trust rather than certifying angles off a shaky view estimate.
    use_az = float(azimuth_deg)
    if estimate_azimuth and az_samples:
        az_arr = np.asarray(az_samples, dtype=float)
        iqr = float(np.percentile(az_arr, 75) - np.percentile(az_arr, 25))
        use_az = float(np.percentile(az_arr, 75)) if iqr > 25.0 else float(np.median(az_arr))
    return S, idxs, mean_conf, use_az, excluded_pct, truncated


def analyze_2d_sagittal_stream(frame_iter: Iterable[dict], fps: float,
                               azimuth_deg: float, clip_id: str = "clip",
                               min_frames: int = 8, max_frames: int = 450,
                               overlay_out: list | None = None,
                               source_fps: float | None = None,
                               capture_fps: float | None = None,
                               image_down: tuple[float, float] | None = None,
                               estimate_azimuth: bool = True,
                               timing_signal: list | None = None,
                               timing_fps: float | None = None,
                               vp_override: float | None = None,
                               recon_conf: float = 1.0) -> dict[str, Any]:
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

    S, idxs, mean_conf, use_az, excluded_pct, truncated = _collect_scalars(
        frame_iter, azimuth_deg, min_frames=min_frames, max_frames=max_frames,
        overlay_out=overlay_out, src_fps=src_fps, image_down=image_down,
        estimate_azimuth=estimate_azimuth,
    )
    result = _assemble(S, idxs, pose_fps, mean_conf, use_az, clip_id,
                       capture_fps=cap_fps, source_fps=src_fps,
                       timing_signal=timing_signal, timing_fps=timing_fps,
                       dropped_pct=excluded_pct, vp_override=vp_override,
                       recon_conf=recon_conf)
    if truncated:
        result["captureQuality"]["truncated"] = True
        result["captureQuality"]["analysedSeconds"] = round(len(idxs) / max(pose_fps, 1e-6), 1)
    return result


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
