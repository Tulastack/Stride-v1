"""Monocular lift: does it actually recover 3D structure?

The module this replaces (`wham_lift.smpl_gravity_lift`) set depth to a linear
function of the 2D detector's CONFIDENCE score, producing a flat slab about 3%
thick and calling it a reconstruction. So the bar these tests defend is not
"does it run" but "is the third dimension real": the lift must recover depth it
was never given, and must not quietly collapse to a plane.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from src.canonical_2d import CANON_KP as KP
from src.lift3d import (
    BONES, CLOSING, TREE, USED,
    _L, lift_sequence, rays_from_keypoints,
)

W, H = 1080, 1920
FOCAL = H / (2 * math.tan(math.radians(30.0)))
INTR = {"focalLengthPx": FOCAL, "principalPointPx": [W / 2.0, H / 2.0]}


def _skeleton(t: float, yaw_deg: float = 45.0) -> np.ndarray:
    """An articulated figure built in its OWN body frame, then placed obliquely.

    Built facing +X with up +Y and its left side toward +Z, then yawed so the
    sagittal plane sits at an angle to the camera. Two properties matter:

    * limbs swing in the body's sagittal plane, which after the yaw has a real
      depth component -- so the lift has genuine depth to recover rather than
      in-plane motion any flat projection would reproduce;
    * the figure TRAVELS along its facing direction, which is what makes
      handedness well defined. A stationary subject has no forward direction,
      and the mirror ambiguity is then unresolvable from geometry alone.
    """
    k = np.full((17, 3), np.nan)
    ph = 2 * math.pi * t
    THIGH, SHANK, UPPER, FORE = 0.45, 0.43, 0.30, 0.26
    body = {}
    body["left_hip"] = np.array([0.0, 0.0, 0.09])
    body["right_hip"] = np.array([0.0, 0.0, -0.09])
    body["left_shoulder"] = np.array([0.0, 0.52, 0.19])
    body["right_shoulder"] = np.array([0.0, 0.52, -0.19])
    body["nose"] = np.array([0.03, 0.72, 0.0])
    for side, z, off in (("left", 0.09, 0.0), ("right", -0.09, math.pi)):
        s, c = math.sin(ph + off), math.cos(ph + off)
        # Limbs are built from joint ANGLES, so every bone length is rigid by
        # construction. Animating joint positions directly would let bone
        # lengths drift, and a lift that assumes rigid bones cannot fit that --
        # it would be testing the fixture's inconsistency, not the algorithm.
        th = math.radians(46.0 + 40.0 * s)                 # thigh from vertical
        tdir = np.array([math.sin(th), -math.cos(th), 0.0])
        knee = body[f"{side}_hip"] + tdir * THIGH
        kf = math.radians(180.0 - (108.0 - 46.0 * c))      # knee joint angle
        ck, sk = math.cos(kf), math.sin(kf)
        sdir = np.array([tdir[0] * ck - tdir[1] * sk, tdir[0] * sk + tdir[1] * ck, 0.0])
        body[f"{side}_knee"] = knee
        body[f"{side}_ankle"] = knee + sdir * SHANK
        ua = np.array([-0.32 + 0.30 * s, -0.94, 0.0]); ua /= np.linalg.norm(ua)
        elbow = body[f"{side}_shoulder"] + ua * UPPER
        ef = math.radians(180.0 - (90.0 + 14.0 * s))
        ce, se = math.cos(ef), math.sin(ef)
        fa = np.array([ua[0] * ce - ua[1] * se, ua[0] * se + ua[1] * ce, 0.0])
        body[f"{side}_elbow"] = elbow
        body[f"{side}_wrist"] = elbow + fa * FORE

    a = math.radians(yaw_deg)
    ca, sa = math.cos(a), math.sin(a)
    R = np.array([[ca, 0.0, sa], [0.0, 1.0, 0.0], [-sa, 0.0, ca]])
    origin = np.array([0.0, 0.0, 0.0]) + R @ np.array([2.2 * t, 0.0, 0.0])
    place = np.array([0.0, 0.0, 5.4])
    for name, v in body.items():
        k[KP[name]] = R @ np.asarray(v, dtype=float) + origin + place
    return k


def _project(poses: np.ndarray, noise_px: float = 0.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros((len(poses), 17, 3))
    for t, P in enumerate(poses):
        for j in range(17):
            if not np.isfinite(P[j]).all():
                continue
            px = FOCAL * P[j, 0] / P[j, 2] + W / 2.0
            py = -FOCAL * P[j, 1] / P[j, 2] + H / 2.0
            if noise_px:
                px += rng.normal(0, noise_px)
                py += rng.normal(0, noise_px)
            out[t, j] = [py / H, px / W, 0.9]
    return out


def _clip(n=40, yaw_deg=45.0):
    poses = np.array([_skeleton(i / 30.0, yaw_deg) for i in range(n)])
    return poses, _project(poses)


# ── structure ─────────────────────────────────────────────────────────────────

def test_tree_spans_every_joint_exactly_once():
    """A spanning tree, or depth propagation would double-assign a joint."""
    assert len(TREE) == len(USED) - 1
    children = [b for _, b in TREE]
    assert len(set(children)) == len(children)
    assert set(children) | {"left_hip"} == set(USED)


def test_closing_edges_exist_to_score_hypotheses():
    """Without redundant constraints nothing can rank the depth-sign branches."""
    assert len(CLOSING) >= 3
    for a, b in CLOSING:
        assert (a, b) not in TREE and (b, a) not in TREE


def test_every_bone_has_a_length_either_way_round():
    lengths = {(a, b): L for a, b, L, _ in BONES}
    for a, b in TREE + CLOSING:
        assert _L(lengths, a, b) > 0


def test_rays_invert_the_projection():
    P = np.array([0.4, -0.3, 5.0])
    px = FOCAL * P[0] / P[2] + W / 2.0
    py = -FOCAL * P[1] / P[2] + H / 2.0
    kp = np.array([[py / H, px / W, 0.9]])
    d = rays_from_keypoints(kp, FOCAL, FOCAL, W / 2.0, H / 2.0, W, H)[0]
    assert np.allclose(d * P[2], P, atol=1e-6)


# ── the actual claim ──────────────────────────────────────────────────────────

def test_recovers_depth_it_was_never_given():
    """THE test. The 2D input contains no depth; the output must.

    This was xfail for a long time: a leg reconstructed folding backwards has
    identical bone lengths and an identical knee angle, so neither bone closure
    nor joint limits separate it, and correlation sat at -0.78 and then +0.449.

    What closed it was not a better anatomical prior — the knee-anterior prior
    turned out to hold only 48% of a stride and was removed. It was two
    conditioning fixes: an out-of-sagittal-plane regulariser gated on
    observability, and lowering the temporal weight that had been compressing
    real depth excursion. Correlation now sits at ~0.64.

    Keep this strict. It is the one test that says the third dimension is real
    rather than plausible-looking."""
    poses, kp = _clip()
    lifted, conf, q = lift_sequence(kp, INTR, W, H)
    ok = np.isfinite(lifted).all(axis=2)
    assert ok.sum() > 0

    truth, got = [], []
    for t in range(len(poses)):
        if not (ok[t, KP["left_ankle"]] and ok[t, KP["left_hip"]]):
            continue
        truth.append(poses[t, KP["left_ankle"], 2] - poses[t, KP["left_hip"], 2])
        got.append(lifted[t, KP["left_ankle"], 2] - lifted[t, KP["left_hip"], 2])
    assert len(truth) > 10
    r = float(np.corrcoef(truth, got)[0, 1])
    assert r > 0.6, f"recovered depth does not track the truth (r={r:.3f})"


def test_output_is_not_a_flat_plane():
    """The regression guard for the defect this module replaces: a lift whose
    depth spread is a rounding error is not a lift."""
    poses, kp = _clip()
    lifted, _, _ = lift_sequence(kp, INTR, W, H)
    used = [KP[n] for n in USED]
    fr = lifted[:, used][np.isfinite(lifted[:, used]).all(axis=2).all(axis=1)]
    assert len(fr) > 5, "no fully-solved frames"
    z = fr[:, :, 2]
    spread = float(np.mean(z.max(axis=1) - z.min(axis=1)))
    extent = float(np.mean(np.linalg.norm(fr.max(axis=1) - fr.min(axis=1), axis=1)))
    assert spread / extent > 0.10, f"skeleton is nearly planar ({spread:.3f} m)"


def test_bone_lengths_survive_the_lift():
    """Bone lengths are the constraint the whole method rests on, so a solve
    that violates them has not solved anything. This assertion would have
    caught the 7.9 cm shank the previous Stage 3 produced on every frame."""
    poses, kp = _clip()
    lifted, _, _ = lift_sequence(kp, INTR, W, H)
    nominal = {(a, b): L for a, b, L, _ in BONES}
    for a, b in (("left_hip", "left_knee"), ("left_knee", "left_ankle"),
                 ("right_hip", "right_knee"), ("right_knee", "right_ankle")):
        vals = []
        for P in lifted:
            if np.isfinite(P[KP[a]]).all() and np.isfinite(P[KP[b]]).all():
                vals.append(float(np.linalg.norm(P[KP[b]] - P[KP[a]])))
        assert vals
        med = float(np.median(vals))
        assert 0.6 * _L(nominal, a, b) < med < 1.6 * _L(nominal, a, b), \
            f"{a}->{b} came out {med:.3f} m"


def test_survives_keypoint_noise():
    poses, _ = _clip()
    lifted, _, _ = lift_sequence(_project(poses, noise_px=2.0, seed=3), INTR, W, H)
    assert np.isfinite(lifted).all(axis=2).sum() > 0.5 * len(poses) * len(USED)


def test_quality_reports_a_measured_residual():
    """Reported uncertainty must come from something the solve could not
    explain, not from a constant. The number this replaces was ~0.09 on every
    clip because it compared a projection against its own constraint."""
    poses, kp = _clip()
    _, _, q = lift_sequence(kp, INTR, W, H)
    for key in ("closingRmsM", "closingRelTorso", "anatomyDeg", "reconConf"):
        assert key in q
    assert 0.0 <= q["reconConf"] <= 0.92
    _, _, q_bad = lift_sequence(_project(poses, noise_px=14.0, seed=5), INTR, W, H)
    assert q_bad["closingRelTorso"] > q["closingRelTorso"], \
        "closure residual did not respond to badly degraded input"


def test_too_short_a_clip_fails_loudly():
    poses, kp = _clip(n=3)
    with pytest.raises(ValueError, match="low_confidence_video"):
        lift_sequence(kp, INTR, W, H)


def test_low_confidence_joints_are_dropped_not_guessed():
    poses, kp = _clip()
    kp[:, KP["left_wrist"], 2] = 0.05
    lifted, conf, _ = lift_sequence(kp, INTR, W, H)
    assert np.isnan(lifted[:, KP["left_wrist"]]).all()
    assert (conf[:, KP["left_wrist"]] == 0).all()

# ── capture viability ─────────────────────────────────────────────────────────

def test_apparent_scale_separates_clips_the_lift_can_and_cannot_serve():
    """The gate that decides whether a 3D lift is even attempted.

    Depth from bone constraints comes out of perspective, and perspective
    strength scales with how much of the frame the athlete fills. Measured
    across the real clip set this was the strongest single predictor of
    reconstruction failure (correlation -0.73 with bone-closure residual):

        torso/frame   0.130  0.112  0.055  0.051  0.042  0.016
        closure       0.086  0.254  0.406  0.459  0.356  0.470

    So it is checked before the solve rather than after it.
    """
    from src.lift3d import apparent_scale

    def _clip_at(torso_frac: float, n: int = 12):
        """Frames whose shoulder-hip span is a known fraction of frame height."""
        out = []
        for _ in range(n):
            k = np.full((17, 3), np.nan)
            for name in ("left_shoulder", "right_shoulder", "left_hip", "right_hip"):
                k[KP[name]] = [0.0, 0.0, 0.9]
            # y is normalised and increases downward; put shoulders above hips.
            for name in ("left_shoulder", "right_shoulder"):
                k[KP[name]] = [0.5 - torso_frac, 0.5, 0.9]
            for name in ("left_hip", "right_hip"):
                k[KP[name]] = [0.5, 0.5, 0.9]
            out.append(k)
        return out

    big = apparent_scale(_clip_at(0.13), 1280, 720)
    small = apparent_scale(_clip_at(0.02), 1920, 1080)
    assert abs(big - 0.13) < 0.01, big
    assert abs(small - 0.02) < 0.01, small
    assert small < big

    # Resolution-free: the same framing on a different sensor is the same number.
    assert abs(apparent_scale(_clip_at(0.13), 1920, 1080) - big) < 0.01


def test_apparent_scale_is_zero_when_the_torso_cannot_be_measured():
    """Returns 0.0 rather than raising, so a clip with no usable torso routes to
    the 2D path instead of failing the analysis."""
    from src.lift3d import apparent_scale
    blank = [np.full((17, 3), np.nan) for _ in range(6)]
    assert apparent_scale(blank, 1080, 1920) == 0.0
