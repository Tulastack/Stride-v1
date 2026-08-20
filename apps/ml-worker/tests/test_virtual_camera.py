"""The angle-agnostic property, proved end to end.

`biomech2d` measures in the image plane, so its numbers depend on where the
phone was. The existing response is a confidence discount (`_viewpoint_penalty`)
— honest, but a label on a biased number. `virtual_camera` removes the bias
instead: it rotates a 3D skeleton into a canonical frame derived from the
athlete's own body plus gravity, then re-projects through a virtual camera
placed exactly on-axis.

These tests assert the property that matters: **the SAME run filmed from any
camera position must produce the same measurements.** Each invariance test is
paired with a negative control showing the naive image-plane projection does
NOT have that property, so the tests cannot pass trivially.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from src.biomech2d import analyze_2d_sagittal_stream
from src.canonical_2d import CANON_KP as KP
from src.virtual_camera import (
    canonical_rotation,
    gravity_up,
    heading_from_poses,
    reproject,
)

FPS = 30.0
N_FRAMES = 90
CAMERA_ANGLES = (0, 25, 45, 70, 90, 135, 200, 310)


def _sprint_pose(t: float) -> np.ndarray:
    """A crude but anatomically ordered sprint stride in the world frame.

    World axes: +X running direction, +Y gravity up, +Z lateral. The athlete
    travels along +X, the pelvis oscillates vertically at twice stride rate, and
    the legs counter-phase. Exact realism is not the point — the point is a
    signal with real structure in all three axes, so that a projection which
    loses a plane cannot accidentally agree with one that keeps it."""
    k = np.full((17, 3), np.nan)
    ph = 2 * math.pi * t
    x = 3.0 * t
    hip_y = 0.95 + 0.03 * math.sin(2 * ph)

    k[KP["left_hip"]] = [x, hip_y, 0.09]
    k[KP["right_hip"]] = [x, hip_y, -0.09]
    k[KP["left_shoulder"]] = [x - 0.05, hip_y + 0.50, 0.18]
    k[KP["right_shoulder"]] = [x - 0.05, hip_y + 0.50, -0.18]
    k[KP["nose"]] = [x, hip_y + 0.68, 0.0]

    for side, sign, offset in (("left", 1, 0.0), ("right", -1, math.pi)):
        th = ph + offset
        k[KP[f"{side}_knee"]] = [
            x + 0.35 * math.sin(th), hip_y - 0.42 + 0.10 * math.cos(th), sign * 0.09]
        k[KP[f"{side}_ankle"]] = [
            x + 0.55 * math.sin(th) - 0.10, hip_y - 0.85 + 0.22 * math.cos(th), sign * 0.09]
        k[KP[f"{side}_elbow"]] = [
            x - 0.10 * math.sin(th), hip_y + 0.22, sign * 0.20]
        k[KP[f"{side}_wrist"]] = [
            x - 0.25 * math.sin(th), hip_y + 0.02, sign * 0.20]
    return k


def _clip() -> tuple[np.ndarray, np.ndarray]:
    poses = np.array([_sprint_pose(i / FPS) for i in range(N_FRAMES)])
    conf = np.full((N_FRAMES, 17), 0.85)
    return poses, conf


def _rot_yaw(deg: float) -> np.ndarray:
    """Rotation about gravity. Rotating the WORLD is equivalent to moving the
    camera, so this simulates filming the same run from a different position."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0.0, -s], [0.0, 1.0, 0.0], [s, 0.0, c]])


def _rot_pitch(deg: float) -> np.ndarray:
    """Rotation about the lateral axis — a phone tilted up or down."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def _metrics(frames: list[dict]) -> dict[str, float]:
    result = analyze_2d_sagittal_stream(
        iter(frames),
        fps=FPS,
        azimuth_deg=0.0,        # a virtual side camera IS azimuth 0 by construction
        estimate_azimuth=False,  # so never re-estimate it from keypoints
        image_down=(1.0, 0.0),   # gravity maps onto image vertical by construction
        source_fps=FPS,
        capture_fps=FPS,
        clip_id="vc-test",
    )
    return {m["key"]: m["measured"]["value"] for m in result["metrics"]}


def _naive_projection(poses: np.ndarray, conf: np.ndarray) -> list[dict]:
    """NEGATIVE CONTROL: what today's pipeline effectively does — project onto
    the camera's own image plane (drop the depth axis) with no canonical
    rotation. Produces the viewpoint dependence this module exists to remove."""
    frames = []
    for i, p in enumerate(poses):
        kp = np.zeros((17, 3))
        finite = np.isfinite(p).all(axis=1)
        # world X,Y straight into image, scaled to a comparable range
        kp[:, 0] = np.where(finite, -(p[:, 1] - 0.95) * 0.6 + 0.5, 0.0)
        kp[:, 1] = np.where(finite, (p[:, 0] - 3.0 * i / FPS) * 0.6 + 0.5, 0.0)
        kp[:, 2] = np.where(finite, conf[i], 0.0)
        frames.append({"frame_index": i, "keypoints": kp,
                       "avg_confidence": 0.85, "excluded": False})
    return frames


# ── heading + rotation ────────────────────────────────────────────────────────

def test_heading_recovers_running_direction():
    poses, _ = _clip()
    h = heading_from_poses(poses, gravity_up(None))
    assert np.allclose(h, [1.0, 0.0, 0.0], atol=1e-6), h


def test_heading_follows_a_rotated_world():
    """Heading is derived from the body, so it must rotate with it. This is why
    a world rotation cancels out of the canonical frame."""
    poses, _ = _clip()
    for deg in CAMERA_ANGLES:
        R = _rot_yaw(deg)
        h = heading_from_poses(poses @ R.T, gravity_up(None))
        assert np.allclose(h, R @ np.array([1.0, 0.0, 0.0]), atol=1e-6), (deg, h)


def test_heading_falls_back_to_hip_normal_without_travel():
    """A treadmill clip or an in-place drill has no net pelvis travel, so the
    estimator must fall back to facing rather than returning garbage."""
    poses = np.array([_sprint_pose(i / FPS) for i in range(N_FRAMES)])
    poses[:, :, 0] -= poses[:, KP["left_hip"], 0][:, None]  # cancel travel
    h = heading_from_poses(poses, gravity_up(None))
    assert abs(float(np.linalg.norm(h)) - 1.0) < 1e-6
    assert abs(abs(float(np.dot(h, [1.0, 0.0, 0.0]))) - 1.0) < 1e-6, h


def test_indeterminate_heading_raises_rather_than_guessing():
    poses = np.full((10, 17, 3), np.nan)
    with pytest.raises(ValueError, match="indeterminate_heading"):
        canonical_rotation(poses)


def test_canonical_rotation_is_orthonormal():
    poses, _ = _clip()
    R = canonical_rotation(poses)
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-9)
    assert abs(float(np.linalg.det(R)) - 1.0) < 1e-9


# ── the core property ─────────────────────────────────────────────────────────

def test_metrics_are_invariant_to_camera_position():
    """THE test. Same run, eight camera positions, one set of numbers."""
    poses, conf = _clip()
    baseline = _metrics(reproject(poses, conf, "side"))
    assert baseline, "no metrics produced"

    for deg in CAMERA_ANGLES:
        got = _metrics(reproject(poses @ _rot_yaw(deg).T, conf, "side"))
        for key, base_val in baseline.items():
            assert key in got, f"{key} vanished at {deg}deg"
            assert abs(got[key] - base_val) < 0.5, (
                f"{key} moved {abs(got[key] - base_val):.3f} at camera {deg}deg "
                f"({base_val:.2f} -> {got[key]:.2f})")


def test_naive_projection_is_NOT_invariant():
    """Negative control. Without the canonical rotation the same metrics swing
    wildly with camera position — which is what makes the test above meaningful
    rather than tautological."""
    poses, conf = _clip()
    base = _metrics(_naive_projection(poses, conf))
    worst = 0.0
    for deg in (30, 60, 90):
        got = _metrics(_naive_projection(poses @ _rot_yaw(deg).T, conf))
        for key, bv in base.items():
            if key in got:
                worst = max(worst, abs(got[key] - bv))
    assert worst > 5.0, f"naive projection was suspiciously stable ({worst:.3f})"


def test_metrics_are_invariant_to_camera_pitch_given_measured_gravity():
    """A tilted phone must not change the numbers, PROVIDED gravity is measured.
    This is the property gravity.ts was written for and never wired up."""
    poses, conf = _clip()
    baseline = _metrics(reproject(poses, conf, "side"))
    for deg in (10, 25, 40):
        R = _rot_pitch(deg)
        tilted = poses @ R.T
        up = R @ np.array([0.0, 1.0, 0.0])   # gravity as the tilted phone measures it
        got = _metrics(reproject(tilted, conf, "side", up_world=up))
        for key, bv in baseline.items():
            assert abs(got[key] - bv) < 0.5, f"{key} moved under {deg}deg pitch"


def test_pitch_without_measured_gravity_does_corrupt_angles():
    """Negative control for the test above: assuming +Y is up when the phone was
    tilted is exactly the failure mode measured gravity prevents."""
    poses, conf = _clip()
    baseline = _metrics(reproject(poses, conf, "side"))
    got = _metrics(reproject(poses @ _rot_pitch(35).T, conf, "side"))
    moved = max(abs(got[k] - v) for k, v in baseline.items() if k in got)
    assert moved > 3.0, f"tilt was absorbed without measured gravity ({moved:.3f})"


# ── projection mechanics ──────────────────────────────────────────────────────

def test_side_view_collapses_mediolateral_span():
    """Azimuth 0 means the hip line points at the camera, so it projects to
    ~nothing. Verifying this is verifying the virtual camera is where we think."""
    poses, conf = _clip()
    frames = reproject(poses, conf, "side")
    kp = frames[0]["keypoints"]
    assert abs(kp[KP["left_hip"], 1] - kp[KP["right_hip"], 1]) < 1e-9


def test_front_view_preserves_mediolateral_span():
    """The frontal camera is the inverse: hip width is fully visible, which is
    what makes knee valgus and pelvic drop measurable at all."""
    poses, conf = _clip()
    frames = reproject(poses, conf, "front")
    kp = frames[0]["keypoints"]
    assert abs(kp[KP["left_hip"], 1] - kp[KP["right_hip"], 1]) > 0.01


def test_both_views_share_one_rotation():
    """Passing the same rotation to both passes keeps the two measurements
    describing the same athlete in the same frame."""
    poses, conf = _clip()
    R = canonical_rotation(poses)
    side = reproject(poses, conf, "side", rotation=R)
    front = reproject(poses, conf, "front", rotation=R)
    assert len(side) == len(front) == N_FRAMES
    # vertical axis is shared between the two views, so hip height must agree
    assert abs(side[0]["keypoints"][KP["left_hip"], 0]
               - front[0]["keypoints"][KP["left_hip"], 0]) < 1e-9


def test_vertical_oscillation_survives_reprojection():
    """Regression guard for the per-frame-normalization trap: pinning the pelvis
    every frame (as stage4's per-frame basis does) would zero this signal."""
    poses, conf = _clip()
    frames = reproject(poses, conf, "side")
    hip_y = np.array([(f["keypoints"][KP["left_hip"], 0]
                       + f["keypoints"][KP["right_hip"], 0]) / 2
                      for f in frames if not f["excluded"]])
    assert float(hip_y.max() - hip_y.min()) > 0.01


def test_absent_joints_stay_absent():
    poses, conf = _clip()
    poses[:, KP["left_wrist"], :] = np.nan
    frames = reproject(poses, conf, "side")
    assert all(f["keypoints"][KP["left_wrist"], 2] == 0.0 for f in frames)


def test_detector_confidence_is_carried_through():
    """A joint the 2D detector never saw is a joint the lifter guessed, and the
    trust layer downstream has to be able to tell."""
    poses, conf = _clip()
    conf[:, KP["right_ankle"]] = 0.2
    frames = reproject(poses, conf, "side")
    assert frames[0]["keypoints"][KP["right_ankle"], 2] == pytest.approx(0.2)


def test_unusable_clip_fails_loudly():
    poses, conf = _clip()
    poses[10:, :, :] = np.nan
    with pytest.raises(ValueError, match="low_confidence_video"):
        reproject(poses, conf, "side")


def test_output_matches_the_pose_backend_contract():
    poses, conf = _clip()
    for f in reproject(poses, conf, "side"):
        assert set(("frame_index", "keypoints", "avg_confidence", "excluded")) <= set(f)
        assert f["keypoints"].shape == (17, 3)
