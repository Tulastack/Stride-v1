"""Monocular 2D->3D lift by bone-constrained depth optimization.

Why this is geometry and not a learned model
--------------------------------------------
Lifting 2D keypoints to 3D is under-determined in general, but it stops being
under-determined once you know the subject's bone lengths. The 2D detection
already fixes each joint's ray through the camera; the only unknown left is
WHERE ALONG THAT RAY the joint sits. So a frame with 17 keypoints has 17
unknowns, not 51, and every bone supplies an equation:

    | z_j * d_j  -  z_i * d_i |  =  L_ij

where d is the (unnormalised) ray direction through a keypoint and z is depth.
With 14 bones over 13 used joints the system is over-determined per frame, and
the redundancy from the closed loops (hips -> shoulders -> hips) is what pins
down configurations a tree alone would leave ambiguous.

This matters for Stride specifically: every metric the pipeline reports is an
angle or a hip-normalised ratio, so the absolute scale a monocular view can
never recover is not needed. What IS needed is relative 3D structure, and that
is exactly what bone constraints provide.

What this is NOT
----------------
It is not a learned lifter and does not claim learned-lifter accuracy on
arbitrary motion. It has no prior over human dynamics beyond bone lengths,
temporal smoothness and joint-limit sanity. It replaces `wham_lift.py`, whose
"depth" was a linear function of the 2D detector's CONFIDENCE score and which
produced a flat 3.3%-thick slab -- i.e. not a reconstruction at all.

The depth-sign ambiguity
------------------------
Each bone's quadratic has two roots: the child can lie nearer the camera or
further. That is a real, irreducible ambiguity in a single view (the classic
"is the arm reaching toward me or away") and no amount of optimisation removes
it from one frame in isolation. It is resolved here by continuity: the correct
branch produces smooth motion across the clip, wrong branches produce a
skeleton that snaps. Frame 0 is seeded by multi-start and the whole sequence is
then refined forward and backward.
"""

from __future__ import annotations

import logging
import math
import os
from typing import Any, Iterable

import numpy as np
from scipy.optimize import least_squares

from src.canonical_2d import CANON_KP as KP, NUM_CANON

logger = logging.getLogger(__name__)

# Joints this lift solves for. Eyes and ears are excluded: they carry no bone
# constraint that matters and no metric reads them, so including them would add
# unknowns without adding equations.
USED = ("nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
        "left_wrist", "right_wrist", "left_hip", "right_hip",
        "left_knee", "right_knee", "left_ankle", "right_ankle")
USED_IDX = [KP[n] for n in USED]
_POS = {n: i for i, n in enumerate(USED)}

# (joint_a, joint_b, nominal length in metres for a ~1.80 m athlete, weight).
# Lengths are PRIORS that get re-estimated from the clip; the weights say how
# much each constraint should be trusted when they disagree. Limb bones are
# rigid and get full weight; the torso diagonals and head are softer because
# shoulder and nose keypoints sit on soft tissue that moves.
BONES: tuple[tuple[str, str, float, float], ...] = (
    ("left_hip", "right_hip", 0.18, 1.0),
    ("left_hip", "left_knee", 0.45, 1.0),
    ("left_knee", "left_ankle", 0.43, 1.0),
    ("right_hip", "right_knee", 0.45, 1.0),
    ("right_knee", "right_ankle", 0.43, 1.0),
    ("left_shoulder", "right_shoulder", 0.38, 1.0),
    ("left_shoulder", "left_elbow", 0.30, 1.0),
    ("left_elbow", "left_wrist", 0.26, 1.0),
    ("right_shoulder", "right_elbow", 0.30, 1.0),
    ("right_elbow", "right_wrist", 0.26, 1.0),
    ("left_shoulder", "left_hip", 0.52, 0.8),
    ("right_shoulder", "right_hip", 0.52, 0.8),
    # Cross-diagonals close the torso loop. Without them the shoulder girdle can
    # rotate freely about the hip line at zero cost.
    ("left_shoulder", "right_hip", 0.59, 0.6),
    ("right_shoulder", "left_hip", 0.59, 0.6),
    ("left_shoulder", "nose", 0.28, 0.4),
    ("right_shoulder", "nose", 0.28, 0.4),
)

# Spanning tree used to propagate depth outward from the root. The edges NOT in
# this tree (the closing edges) are what score a hypothesis: they are redundant
# constraints the propagation never used, so a wrong depth-sign choice shows up
# as a torso that will not close.
ROOT = "left_hip"
TREE: tuple[tuple[str, str], ...] = (
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
    ("left_hip", "left_shoulder"), ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
    ("left_shoulder", "nose"),
)

CONF_FLOOR = 0.25          # below this a keypoint contributes no constraint
W_TEMPORAL = 0.55          # depth continuity between neighbouring frames
MAX_NFEV = 80
BEAM = 24                  # hypotheses kept while walking the tree
DEPTH_GRID = (0.75, 0.9, 1.0, 1.15, 1.35)   # root-depth multipliers searched


def rays_from_keypoints(kp: np.ndarray, fx: float, fy: float,
                        cx: float, cy: float, w: int, h: int) -> np.ndarray:
    """Unit-ish ray directions through each keypoint, camera frame.

    Input keypoints are the pipeline's canonical `[y, x, conf]` with y and x
    normalised to [0,1] and y increasing DOWNWARD. Output is right-handed with
    +X right, +Y up, +Z into the scene, so a gravity vector from the phone IMU
    can be handed straight to the canonical-frame builder.
    """
    px = kp[:, 1] * w
    py = kp[:, 0] * h
    d = np.stack([(px - cx) / fx, -(py - cy) / fy, np.ones(len(kp))], axis=1)
    return d


CLOSING = tuple((a, b) for a, b, _, _ in BONES
                if (a, b) not in TREE and (b, a) not in TREE)


def _L(lengths, a, b) -> float:
    """Bone length, whichever way round the edge was written."""
    v = lengths.get((a, b))
    return float(v if v is not None else lengths[(b, a)])


def _root_depth_bound(rays, valid, lengths):
    """Tightest upper bound on root depth from apparent limb size.

    A bone of true length L whose in-plane extent subtends an angle theta sits at
    depth Z = L_perp / tan(theta) <= L / tan(theta). The smallest such bound over
    all visible bones is the closest the athlete can possibly be while still
    being big enough to contain every bone.
    """
    best = np.inf
    for a, b, _, _ in BONES:
        i, j = _POS[a], _POS[b]
        if not (valid[i] and valid[j]):
            continue
        # angular separation of the two rays
        u = rays[i] / np.linalg.norm(rays[i])
        v = rays[j] / np.linalg.norm(rays[j])
        ang = math.acos(float(np.clip(np.dot(u, v), -1, 1)))
        if ang < 1e-6:
            continue
        best = min(best, _L(lengths, a, b) / math.tan(ang))
    return float(best) if np.isfinite(best) else 4.0


# Anatomical limits, degrees. A wrong depth-sign branch almost always shows up
# as a joint bent the way that joint does not bend -- a knee hyperextending, an
# elbow folding backwards. Four bone-length closing edges cannot separate 2^12
# sign combinations on their own; these limits do most of the remaining work,
# and they cost nothing because the angles are already being computed.
JOINT_LIMITS: tuple[tuple[str, str, str, float, float], ...] = (
    ("left_hip", "left_knee", "left_ankle", 28.0, 182.0),
    ("right_hip", "right_knee", "right_ankle", 28.0, 182.0),
    ("left_shoulder", "left_elbow", "left_wrist", 22.0, 182.0),
    ("right_shoulder", "right_elbow", "right_wrist", 22.0, 182.0),
)
W_ANATOMY = 0.06           # degrees -> metres-ish, so limits nudge rather than dominate

# Each LIMB carries its own depth-sign branch, independent of the whole-body
# chirality: a leg reconstructed folding backwards has exactly the same bone
# lengths and exactly the same knee ANGLE as the correct one, so neither bone
# closure nor joint limits can separate them. What separates them is direction.
# In running the knee leads -- it sits forward of the hip-ankle line along the
# direction of travel -- and that is a signed test, so it resolves the branch.
# Only informative once the view has some depth component: at side-on the
# knee's offset is already visible in 2D and there is no ambiguity to resolve.
# Measured against exact ground truth (scripts/bench_lift3d.py), the
# "knee sits anterior to the hip-ankle chord" prior holds only 48% of a running
# stride -- a coin flip, because the chord crosses the knee twice per cycle. It
# was penalising correct anatomy as often as wrong, and enabling it moved the
# sweep from 5.56 to 8.10 deg MAE. Kept at zero rather than deleted so the
# finding stays legible: this constraint is not available to separate the
# per-limb depth-sign branches, and something else has to.
W_ANTERIOR = 0.0

# Out-of-sagittal-plane regulariser. Measured cause: a bone lying near the image
# plane is at maximum apparent extent, so its two depth roots nearly merge and
# depth becomes ill-conditioned exactly where the 2D path is strongest. Left
# free, the solve drifts out of plane and corrupts the sagittal angle -- at
# side-on the ankle landed 0.3 m off-plane, rotating the leg ~20 deg.
#
# Running is a predominantly sagittal activity: the knee and ankle track close
# to their own hip's sagittal plane. This pulls them there, but softly, and only
# bites where the data cannot speak -- off-axis the depth IS observable and the
# bone terms dominate. Deliberately weak so the frontal-plane metrics
# (knee_valgus, pelvic_drop) survive; those live in exactly this displacement.
W_SAGITTAL = float(os.environ.get('STRIDE_W_SAGITTAL', '0.6'))
# Exponent on the observability gate; 1.0 = linear in |med_z|, lower = softer.
W_SAG_GATE = float(os.environ.get('STRIDE_W_SAG_GATE', '0.5'))
LEGS = (("left_hip", "left_knee", "left_ankle"),
        ("right_hip", "right_knee", "right_ankle"))


def _anatomy_cost(z, rays) -> float:
    """Total degrees by which the pose violates its own joint limits."""
    bad = 0.0
    for a, b, c, lo, hi in JOINT_LIMITS:
        i, j, k = _POS[a], _POS[b], _POS[c]
        if not (np.isfinite(z[i]) and np.isfinite(z[j]) and np.isfinite(z[k])):
            continue
        A = z[i] * rays[i] - z[j] * rays[j]
        C = z[k] * rays[k] - z[j] * rays[j]
        na, nc = np.linalg.norm(A), np.linalg.norm(C)
        if na < 1e-9 or nc < 1e-9:
            continue
        ang = math.degrees(math.acos(float(np.clip(np.dot(A, C) / (na * nc), -1, 1))))
        bad += max(0.0, lo - ang) + max(0.0, ang - hi)
    return bad


def _closing_cost(z, rays, lengths):
    c = 0.0
    for a, b in CLOSING:
        i, j = _POS[a], _POS[b]
        if not (np.isfinite(z[i]) and np.isfinite(z[j])):
            continue
        d = float(np.linalg.norm(z[j] * rays[j] - z[i] * rays[i])) - _L(lengths, a, b)
        c += d * d
    return c


def _anterior_cost(z, rays, fwd) -> float:
    """Metres by which a knee sits BEHIND the hip-ankle line, summed over legs.

    This is the one constraint that separates a correctly-reconstructed leg from
    the same leg folded backwards: both satisfy every bone length and produce an
    identical knee angle, so closure and joint limits are blind to the
    difference. Only the direction the knee bulges relative to travel tells them
    apart — a knee is anterior to the hip-ankle chord, never posterior.

    Returned in metres so it can be summed with `_closing_cost` on the same
    scale during branch selection.
    """
    if fwd is None:
        return 0.0
    c = 0.0
    for a, b, cj in LEGS:
        i, j, k = _POS[a], _POS[b], _POS[cj]
        if not (np.isfinite(z[i]) and np.isfinite(z[j]) and np.isfinite(z[k])):
            continue
        P_i, P_j, P_k = z[i] * rays[i], z[j] * rays[j], z[k] * rays[k]
        off = P_j - 0.5 * (P_i + P_k)
        c += max(0.0, -float(np.dot(off, fwd)))
    return c


def _propagate(rays, valid, lengths, z_root, beam=BEAM, fwd=None):
    """Exact perspective depth propagation down the tree, beam search on signs.

    For a bone of length L, given the parent depth z_i, the child depth solves

        |z_j d_j - z_i d_i|^2 = L^2

    a genuine quadratic with two real roots whenever the bone is long enough to
    span the angular gap between the rays. The two roots ARE the depth-sign
    ambiguity: child nearer the camera, or further. Both are kept and the
    closing edges decide.
    """
    n = len(USED)
    z0 = np.full(n, np.nan)
    z0[_POS[ROOT]] = z_root
    hyps = [z0]
    for a, b in TREE:
        i, j = _POS[a], _POS[b]
        L = _L(lengths, a, b)
        nxt = []
        for z in hyps:
            if not valid[j] or not np.isfinite(z[i]):
                nxt.append(z.copy())
                continue
            A = float(rays[j] @ rays[j])
            B = -2.0 * z[i] * float(rays[i] @ rays[j])
            C = z[i] ** 2 * float(rays[i] @ rays[i]) - L * L
            disc = B * B - 4 * A * C
            if disc < 0:
                # Bone cannot span the ray gap at this parent depth: take the
                # tangent solution (the closest it can get) and let the cost
                # reflect the violation.
                z2 = z.copy(); z2[j] = max(-B / (2 * A), 0.2)
                nxt.append(z2)
                continue
            r = math.sqrt(disc)
            for s in (1.0, -1.0):
                zj = (-B + s * r) / (2 * A)
                if zj <= 0.2:
                    continue
                z2 = z.copy(); z2[j] = zj
                nxt.append(z2)
        nxt.sort(key=lambda z: _closing_cost(z, rays, lengths)
                 + W_ANATOMY * _anatomy_cost(z, rays))
        hyps = nxt[:beam]
    return hyps


def _residuals(z, rays, bones, prev_z, valid, w_temporal, fwd=None):
    P = rays * z[:, None]
    out = []
    for i, j, L, wt in bones:
        if not (valid[i] and valid[j]):
            out.append(0.0)
            continue
        out.append(wt * (float(np.linalg.norm(P[j] - P[i])) - L))
    for a, b, c, lo, hi in JOINT_LIMITS:
        i, j, k = _POS[a], _POS[b], _POS[c]
        if not (valid[i] and valid[j] and valid[k]):
            out.append(0.0); continue
        A = P[i] - P[j]; C = P[k] - P[j]
        na, nc = np.linalg.norm(A), np.linalg.norm(C)
        if na < 1e-9 or nc < 1e-9:
            out.append(0.0); continue
        ang = math.degrees(math.acos(float(np.clip(np.dot(A, C) / (na * nc), -1, 1))))
        out.append(W_ANATOMY * (max(0.0, lo - ang) + max(0.0, ang - hi)))
    for a, b, c in LEGS:
        i, j, k = _POS[a], _POS[b], _POS[c]
        if fwd is None or not (valid[i] and valid[j] and valid[k]):
            out.append(0.0); continue
        off = P[j] - 0.5 * (P[i] + P[k])
        out.append(W_ANTERIOR * max(0.0, -float(np.dot(off, fwd))))

    # Mediolateral axis from the pelvis itself — the shortest, best-constrained
    # bone in the system, and the only frame-local definition of "sideways" that
    # needs no external heading.
    lh, rh = _POS["left_hip"], _POS["right_hip"]
    if valid[lh] and valid[rh]:
        med = P[_POS["left_hip"]] - P[_POS["right_hip"]]
        nm = float(np.linalg.norm(med))
        if nm > 1e-6:
            med = med / nm
            # Apply this ONLY where the displacement it constrains is
            # unobservable. |med_z| is that test: side-on the pelvis is edge-on,
            # the mediolateral axis points down the viewing axis and lateral
            # offset is pure depth the camera cannot see -- so the prior should
            # carry it. Head-on the axis lies across the image, lateral offset
            # is directly measured, and the prior must get out of the data's way.
            w_sag = W_SAGITTAL * abs(float(med[2])) ** W_SAG_GATE
            for hip, knee, ankle in LEGS:
                h = _POS[hip]
                for joint in (knee, ankle):
                    jj = _POS[joint]
                    if not (valid[h] and valid[jj]):
                        out.append(0.0); continue
                    out.append(w_sag * float(np.dot(P[jj] - P[h], med)))
        else:
            out.extend([0.0] * 4)
    else:
        out.extend([0.0] * 4)
    if prev_z is not None:
        out.extend((w_temporal * (z - prev_z) * valid).tolist())
    else:
        out.extend([0.0] * len(z))
    # No scale anchor. With metric bone lengths and a calibrated camera the
    # absolute depth is determined by perspective, not free -- anchoring it
    # would pull the solve away from the geometry that fixes it.
    return np.asarray(out, dtype=float)


def _solve_frame(rays, bones, valid, init, prev_z, w_temporal=W_TEMPORAL, fwd=None):
    res = least_squares(
        _residuals, init, args=(rays, bones, prev_z, valid, w_temporal, fwd),
        method="trf", bounds=(0.4, 40.0), max_nfev=MAX_NFEV, ftol=1e-4, xtol=1e-4)
    return res.x, float(np.sum(res.fun ** 2))


def _bone_list(lengths: dict[tuple[str, str], float]):
    return [(_POS[a], _POS[b], lengths[(a, b)], w) for a, b, _, w in BONES]


def _estimate_lengths(rays_seq, valid_seq, z_seq, lengths):
    """Re-estimate bone lengths as the median realised length across the clip.

    Blended toward the anthropometric prior so a handful of badly-solved frames
    cannot drag a bone to an impossible value. This is what adapts the lift to
    the actual athlete instead of assuming a reference body.
    """
    out = dict(lengths)
    for a, b, prior, _ in BONES:
        i, j = _POS[a], _POS[b]
        vals = []
        for rays, valid, z in zip(rays_seq, valid_seq, z_seq):
            if not (valid[i] and valid[j]):
                continue
            P = rays * z[:, None]
            vals.append(float(np.linalg.norm(P[j] - P[i])))
        if len(vals) >= 8:
            med = float(np.median(vals))
            # 70% measured / 30% prior, and never more than 2x off the prior
            blended = 0.7 * med + 0.3 * lengths[(a, b)]
            out[(a, b)] = float(np.clip(blended, prior * 0.5, prior * 2.0))
    return out


def chirality_score(poses: np.ndarray, up: np.ndarray | None = None) -> float:
    """Signed handedness of the reconstruction. Positive means correct.

    A single view cannot distinguish a pose from its reflection about the image
    plane: both project identically, both satisfy every bone length, and every
    dot product is preserved, so no distance-based test can tell them apart.
    Only a CHIRAL quantity can, and we have one for free -- the 2D detector
    already told us which hip is the left one.

    With gravity up and the running direction forward, a person's left side lies
    along cross(forward, up). Reflection flips that cross product (it is a
    pseudo-vector) while leaving forward and up themselves intact, so the sign
    of this projection is exactly the bit the geometry lost.
    """
    up = np.array([0.0, 1.0, 0.0]) if up is None else np.asarray(up, float)
    up = up / max(float(np.linalg.norm(up)), 1e-9)
    lh, rh = KP["left_hip"], KP["right_hip"]
    ok = np.isfinite(poses[:, lh]).all(axis=1) & np.isfinite(poses[:, rh]).all(axis=1)
    if ok.sum() < 4:
        return 0.0
    pelvis = (poses[ok, lh] + poses[ok, rh]) / 2.0
    travel = pelvis[-1] - pelvis[0]
    travel = travel - up * float(np.dot(travel, up))
    if float(np.linalg.norm(travel)) < 1e-6:
        return 0.0
    fwd = travel / float(np.linalg.norm(travel))
    left_dir = np.cross(fwd, up)
    hip_axis = poses[ok, lh] - poses[ok, rh]
    return float(np.mean(hip_axis @ left_dir))


def _mirror_depths(z_seq, rays_seq):
    """Reflect every solved depth about the clip's mean depth.

    This lands on the OTHER root of each bone's quadratic, which is what the
    mirror solution is. The refinement pass afterwards pulls it back onto the
    rays exactly."""
    zs = [z for z in z_seq if np.isfinite(z).all()]
    if not zs:
        return z_seq
    zbar = float(np.mean([np.mean(z) for z in zs]))
    # Clip into the solver's depth bounds: a reflected depth can land behind
    # the camera, which is not a pose the refinement is allowed to consider.
    return [np.where(np.isfinite(z), np.clip(2.0 * zbar - z, 0.45, 39.0), z)
            for z in z_seq]


def lift_sequence(
    keypoints: Iterable[np.ndarray],
    intrinsics: dict[str, Any] | None = None,
    width: int = 1080,
    height: int = 1920,
    passes: int = 1,
    up_hint: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Lift a canonical COCO-17 keypoint sequence to 3D in the CAMERA frame.

    Returns (poses (N,17,3) with NaN for unsolved joints, confidence (N,17),
    quality dict carrying a MEASURED reconstruction-uncertainty signal).

    STATUS: partial. Measured against exact ground truth this recovers usable
    sagittal angles near side-on (~2-3 deg MAE at 0-20 deg azimuth, versus ~10
    deg for the 2D path) but degrades sharply off-axis (~9 deg at 35, ~19-24 deg
    beyond 50). Two causes, one fundamental and one not:

      * fundamental -- near head-on the sagittal plane lies along the viewing
        axis, so sagittal angles depend on depth the camera never captured.
        No monocular method recovers this without a learned motion prior. The
        observability gate in analyze3d refuses to certify metrics from such a
        view, which is the honest response.
      * not fundamental -- each limb carries an independent depth-sign branch
        that bone closure and joint limits cannot separate (a backwards leg has
        identical bone lengths and an identical knee angle). The knee-anterior
        prior helps but does not resolve it; see the xfailing depth-recovery
        test. Fixing this is the open work.

    `passes` defaults to 1 because bone-length re-estimation measured WORSE:
    a pass-0 solve with flipped limbs poisons the lengths it estimates.
    The output frame is right-handed, +Y up in image terms; hand it to
    `analyze_3d_angle_agnostic` together with the IMU gravity vector expressed
    in the same camera frame and the canonical builder does the rest.
    """
    kps = [np.asarray(k, dtype=float) for k in keypoints]
    if len(kps) < 4:
        raise ValueError("low_confidence_video")

    intr = intrinsics or {}
    f = float(intr.get("focalLengthPx") or (height / (2 * np.tan(np.radians(30.0)))))
    pp = intr.get("principalPointPx") or [width / 2.0, height / 2.0]
    cx, cy = float(pp[0]), float(pp[1])

    rays_seq, valid_seq, conf_seq = [], [], []
    for k in kps:
        sub = k[USED_IDX]
        rays_seq.append(rays_from_keypoints(sub, f, f, cx, cy, width, height))
        valid_seq.append((sub[:, 2] >= CONF_FLOOR) & np.isfinite(sub[:, 0]))
        conf_seq.append(sub[:, 2])

    lengths = {(a, b): L for a, b, L, _ in BONES}

    z_seq: list[np.ndarray] = []
    # Seeded from the 2D rays, NOT left as None. Previously this was only
    # assigned in the `p < passes - 1` tail, which never runs at the default
    # passes=1 — so the knee-anterior prior silently contributed nothing on
    # every production clip, and the per-limb depth-sign ambiguity it exists to
    # resolve went unresolved.
    fwd = _forward_from_rays(rays_seq, valid_seq, up_hint)
    if fwd is None:
        logger.info("lift: no travel detected, knee-anterior prior disabled")
    for p in range(passes):
        bones = _bone_list(lengths)
        z_seq = []
        prev = None
        for t, (rays, valid) in enumerate(zip(rays_seq, valid_seq)):
            if not valid.any():
                z_seq.append(np.full(len(USED), np.nan))
                continue
            if prev is None:
                # Seed frame: enumerate depth-sign branches by exact perspective
                # propagation, scored on the redundant closing edges, then
                # refine the best few under the full bone system.
                zb = _root_depth_bound(rays, valid, lengths)
                best, best_cost = None, np.inf
                for m in DEPTH_GRID:
                    for cand in _propagate(rays, valid, lengths, zb * m, fwd=fwd)[:4]:
                        init = np.where(np.isfinite(cand), cand, zb * m)
                        z, cost = _solve_frame(rays, bones, valid, init, None, 0.0, fwd=fwd)
                        if cost < best_cost:
                            best, best_cost = z, cost
                z = best
            else:
                z, _ = _solve_frame(rays, bones, valid, prev.copy(), prev, fwd=fwd)
            z_seq.append(z)
            prev = z

        # Backward pass: the forward sweep commits to whatever frame 0 chose, so
        # sweep back with the forward answer as the temporal prior to let later,
        # better-constrained frames correct earlier ones.
        for t in range(len(z_seq) - 2, -1, -1):
            if not valid_seq[t].any() or not np.isfinite(z_seq[t]).all():
                continue
            z, _ = _solve_frame(rays_seq[t], bones, valid_seq[t],
                                z_seq[t].copy(), z_seq[t + 1], fwd=fwd)
            z_seq[t] = z

        # Chirality: the one bit a single view cannot supply. Resolve it once,
        # against the left/right labels the 2D detector already provides, then
        # re-refine so the mirrored depths sit back exactly on their rays.
        if p == 0:
            probe = _assemble_poses(kps, rays_seq, valid_seq, z_seq, conf_seq)[0]
            if chirality_score(probe, up_hint) < 0:
                logger.info("lift: mirror branch detected, reflecting depths")
                z_seq = _mirror_depths(z_seq, rays_seq)
                for _ in range(2):
                    for tt in range(len(z_seq)):
                        if not valid_seq[tt].any() or not np.isfinite(z_seq[tt]).all():
                            continue
                        nb = z_seq[tt - 1] if tt else None
                        z_seq[tt], _ = _solve_frame(rays_seq[tt], bones, valid_seq[tt],
                                                    z_seq[tt].copy(), nb, fwd=fwd)

        if p < passes - 1:
            lengths = _estimate_lengths(rays_seq, valid_seq, z_seq, lengths)
            fwd = _travel_direction(_assemble_poses(kps, rays_seq, valid_seq,
                                                    z_seq, conf_seq)[0], up_hint)

    poses, conf = _assemble_poses(kps, rays_seq, valid_seq, z_seq, conf_seq)
    closing, anatomy = [], []
    for rays, valid, z in zip(rays_seq, valid_seq, z_seq):
        if not np.isfinite(z).all():
            continue
        closing.append(_closing_cost(z, rays, lengths))
        anatomy.append(_anatomy_cost(z, rays))

    quality = _lift_quality(closing, anatomy, lengths)
    return poses, conf, quality


def _lift_quality(closing, anatomy, lengths) -> dict[str, float]:
    """A reconstruction-uncertainty signal that is actually MEASURED.

    This exists because the number it replaces was not. The old pipeline's
    `reconResidual` compared `_project_bone`'s output against `_project_bone`'s
    own constraint, so it was ~0.09 by construction on every clip and still fed
    a 0.91 confidence multiplier straight to the user.

    Both terms here are genuine leftovers the solve could not explain:

      * closing residual -- error on the four bone constraints the depth
        propagation never used. A wrong depth-sign branch cannot hide from
        these, because they were not what chose it.
      * anatomy violation -- degrees by which the recovered pose bends joints
        the way those joints do not bend.

    Mapped to a 0..1 confidence with a deliberately conservative curve. It is
    capped below 1.0: a clean solve is evidence the geometry is consistent, not
    evidence it is correct, and only a criterion-validity study can license
    that stronger claim.
    """
    if not closing:
        return {"closingRmsM": float("nan"), "anatomyDeg": float("nan"), "reconConf": 0.0}
    torso = float(_L(lengths, "left_shoulder", "left_hip"))
    rms = float(np.sqrt(np.mean(closing)))
    rel = rms / max(torso, 1e-6)          # scale-free: fraction of a torso length
    anat = float(np.mean(anatomy))
    # Calibrated against measured angle error (scripts/bench_lift3d.py, 2 px
    # detector noise), not chosen by feel:
    #
    #     relTorso   0.035  0.081  0.137  0.252  0.347
    #     true MAE    1.44   1.38   1.51   3.21   7.63  deg
    #
    # The previous exp(-rel/0.11) read 0.29 at rel=0.137 — a clip whose angles
    # were accurate to 1.5 deg — and that single number was enough to hold every
    # metric below the trust gate. A well-closed solve now keeps its confidence,
    # and only genuinely poor closure is penalised.
    #
    # This is deliberately a SOLVE-quality signal and nothing more. Closure
    # cannot see the failure that dominates near head-on (rel actually FALLS
    # from 0.347 to 0.308 between 70 and 90 deg while true error rises 7.6 -> 17.2),
    # because both depth-sign branches satisfy every bone constraint exactly.
    # View quality is carried separately by analyze3d's observability term, and
    # the two are combined by taking the worse — never multiplied, which would
    # discount the same clip twice and empty the report.
    conf = math.exp(-max(0.0, rel - 0.15) / 0.25) * math.exp(-anat / 26.0)
    return {"closingRmsM": round(rms, 5),
            "closingRelTorso": round(rel, 4),
            "anatomyDeg": round(anat, 2),
            "reconConf": round(float(np.clip(conf, 0.0, 0.92)), 3)}


def _travel_direction(poses, up=None):
    """Horizontal direction of pelvis travel, or None if the subject is static.

    Returns None rather than guessing: with no travel there is no forward, the
    knee-anterior prior is undefined, and applying it from a fabricated
    direction would bias the solve instead of constraining it."""
    up = np.array([0.0, 1.0, 0.0]) if up is None else np.asarray(up, float)
    up = up / max(float(np.linalg.norm(up)), 1e-9)
    lh, rh = KP["left_hip"], KP["right_hip"]
    ok = np.isfinite(poses[:, lh]).all(axis=1) & np.isfinite(poses[:, rh]).all(axis=1)
    if ok.sum() < 4:
        return None
    pel = (poses[ok, lh] + poses[ok, rh]) / 2.0
    v = pel[-1] - pel[0]
    v = v - up * float(np.dot(v, up))
    n = float(np.linalg.norm(v))
    return v / n if n > 0.15 else None


def _forward_from_rays(rays_seq, valid_seq, up=None):
    """Travel direction estimated from the 2D rays alone, before any 3D solve.

    `_travel_direction` needs lifted poses, which makes it useless for
    constraining the lift that produces them. This breaks that circularity: the
    pelvis ray swings across the clip as the athlete travels, and evaluating
    those rays at a constant nominal depth recovers the direction of travel up
    to a scale we do not need. Only the SIGN of the knee's projection onto this
    vector is ever used, so a constant-depth approximation is sufficient — the
    depth drift across a few seconds of running is far too small to flip it.

    Returns None when the subject barely moves; a fabricated forward would bias
    the solve rather than constrain it.
    """
    lh, rh = _POS["left_hip"], _POS["right_hip"]
    ls, rs = _POS["left_shoulder"], _POS["right_shoulder"]
    pel = []
    for rays, valid in zip(rays_seq, valid_seq):
        if not (valid[lh] and valid[rh] and valid[ls] and valid[rs]):
            continue
        hip = 0.5 * (rays[lh] + rays[rh])
        sho = 0.5 * (rays[ls] + rays[rs])
        # Every ray sits at z=1, so differencing rays alone yields a vector with
        # NO depth component — useless for a runner coming toward the camera.
        # Apparent torso height supplies the missing axis: a rigid span of true
        # length L subtends L/Z in ray space, so Z is proportional to 1/span.
        # Torso height is used because it is roughly perpendicular to travel and
        # therefore barely foreshortens as the athlete turns.
        span = float(np.linalg.norm((sho - hip)[:2]))
        if span < 1e-6:
            continue
        pel.append(hip / span)          # ∝ pelvis position, arbitrary scale
    if len(pel) < 4:
        return None
    pel = np.asarray(pel)
    # Endpoints averaged over a few frames each so one bad detection at either
    # end cannot set the direction for the whole clip.
    k = max(1, min(3, len(pel) // 4))
    v = pel[-k:].mean(axis=0) - pel[:k].mean(axis=0)
    if up is not None:
        u = np.asarray(up, float)
        u = u / max(float(np.linalg.norm(u)), 1e-9)
        v = v - u * float(np.dot(v, u))
    n = float(np.linalg.norm(v))
    # Rays are unit-depth directions, so this threshold is an angular sweep of
    # the pelvis across the clip, not a distance in metres.
    return v / n if n > 1e-3 else None


def _assemble_poses(kps, rays_seq, valid_seq, z_seq, conf_seq):
    poses = np.full((len(kps), NUM_CANON, 3), np.nan)
    conf = np.zeros((len(kps), NUM_CANON))
    for t, (rays, valid, z, c) in enumerate(zip(rays_seq, valid_seq, z_seq, conf_seq)):
        if not np.isfinite(z).all():
            continue
        P = rays * z[:, None]
        for n, i in _POS.items():
            if valid[i]:
                poses[t, KP[n]] = P[i]
                conf[t, KP[n]] = c[i]
    return poses, conf


def gravity_up_from_capture(capture: dict[str, Any]) -> np.ndarray | None:
    """World-up in the CAMERA frame, from the phone accelerometer.

    The accelerometer reads gravity plus the operator's own hand acceleration,
    so the samples are averaged over the clip and normalised; a panning shot
    biases this and that limit is real (see the honesty ledger in
    docs/research/angle-agnostic-kinematics.md). Device axes are treated as
    camera axes with +Y up, which holds for an upright portrait capture.
    """
    accel = capture.get("accelerometer") or []
    if not accel:
        return None
    v = np.array([
        float(np.mean([s.get("ax", 0.0) for s in accel])),
        float(np.mean([s.get("ay", 0.0) for s in accel])),
        float(np.mean([s.get("az", 0.0) for s in accel])),
    ])
    n = float(np.linalg.norm(v))
    if n < 1e-6:
        return None
    return v / n
