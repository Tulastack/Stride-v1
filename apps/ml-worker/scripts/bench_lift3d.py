#!/usr/bin/env python3
"""Analytic ground-truth benchmark for the monocular 3D lift.

There is no motion-capture reference for running in this repo, but the lift can
still be measured exactly: build an articulated figure from known joint ANGLES,
place it at a known yaw, project it through a known camera, and ask the lift to
recover what we already know. Because the figure is constructed from angles,
every bone length is rigid by construction and the truth is exact — this
measures the algorithm, not a fixture's inconsistency.

This isolates the LIFT. It says nothing about pose-estimator error on real
video; feed it perfect keypoints and it reports the reconstruction error that
remains even when 2D detection is perfect. That is the floor the real pipeline
sits on top of.

    python3 scripts/bench_lift3d.py                 # sweep yaw, default settings
    python3 scripts/bench_lift3d.py --frames 24     # faster
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.canonical_2d import CANON_KP as KP  # noqa: E402
from src.lift3d import lift_sequence  # noqa: E402

W, H = 1080, 1920
# The camera the projection actually uses. The harness hands the SAME value to
# the lift, so intrinsics error is excluded here on purpose — it is measured
# separately by --focal-error.
FOCAL = H / (2 * math.tan(math.radians(30.0)))


def skeleton(t: float, yaw_deg: float) -> np.ndarray:
    """Articulated figure in its own body frame, yawed into the camera frame.

    Facing +X, up +Y, left side toward +Z. Limbs swing in the body's sagittal
    plane, so after the yaw they carry a real depth component — the thing a flat
    projection cannot reproduce and the lift therefore has to recover.
    """
    k = np.full((17, 3), np.nan)
    ph = 2 * math.pi * t
    THIGH, SHANK, UPPER, FORE = 0.45, 0.43, 0.30, 0.26
    body: dict[str, np.ndarray] = {
        "left_hip": np.array([0.0, 0.0, 0.09]),
        "right_hip": np.array([0.0, 0.0, -0.09]),
        "left_shoulder": np.array([0.0, 0.52, 0.19]),
        "right_shoulder": np.array([0.0, 0.52, -0.19]),
        "nose": np.array([0.03, 0.72, 0.0]),
    }
    for side, off in (("left", 0.0), ("right", math.pi)):
        s, c = math.sin(ph + off), math.cos(ph + off)
        th = math.radians(46.0 + 40.0 * s)
        tdir = np.array([math.sin(th), -math.cos(th), 0.0])
        knee = body[f"{side}_hip"] + tdir * THIGH
        kf = math.radians(180.0 - (108.0 - 46.0 * c))
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
    origin = R @ np.array([2.2 * t, 0.0, 0.0])
    place = np.array([0.0, 0.0, 5.4])
    for name, v in body.items():
        k[KP[name]] = R @ v + origin + place
    return k


def project(poses: np.ndarray, focal: float, noise_px: float = 0.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros((len(poses), 17, 3))
    for t, P in enumerate(poses):
        for j in range(17):
            if not np.isfinite(P[j]).all():
                continue
            px = focal * P[j, 0] / P[j, 2] + W / 2.0
            py = -focal * P[j, 1] / P[j, 2] + H / 2.0
            if noise_px:
                px += rng.normal(0, noise_px)
                py += rng.normal(0, noise_px)
            out[t, j] = [py / H, px / W, 0.9]
    return out


def _ang(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Interior angle at b, in degrees."""
    u, v = a - b, c - b
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-9 or nv < 1e-9:
        return math.nan
    return math.degrees(math.acos(float(np.clip(np.dot(u, v) / (nu * nv), -1, 1))))


# The joint angles every reported metric is ultimately derived from. Measured
# directly on the 3D points so this benchmark is independent of the reprojection
# layer in analyze3d.
def angles(pose: np.ndarray) -> dict[str, float]:
    g = lambda n: pose[KP[n]]  # noqa: E731
    out: dict[str, float] = {}
    for side in ("left", "right"):
        out[f"{side}_knee"] = _ang(g(f"{side}_hip"), g(f"{side}_knee"), g(f"{side}_ankle"))
        sh, hp, kn = g(f"{side}_shoulder"), g(f"{side}_hip"), g(f"{side}_knee")
        out[f"{side}_hip"] = _ang(sh, hp, kn)
    mid_sh = 0.5 * (g("left_shoulder") + g("right_shoulder"))
    mid_hp = 0.5 * (g("left_hip") + g("right_hip"))
    torso = mid_sh - mid_hp
    n = np.linalg.norm(torso)
    out["trunk_lean"] = (
        math.degrees(math.acos(float(np.clip(torso[1] / n, -1, 1)))) if n > 1e-9 else math.nan
    )
    return out


def bench(yaw_deg: float, frames: int, noise_px: float, lift_focal_scale: float,
          **lift_kw) -> dict[str, float]:
    truth = np.array([skeleton(i / 30.0, yaw_deg) for i in range(frames)])
    kp = project(truth, FOCAL, noise_px=noise_px)

    t0 = time.perf_counter()
    lifted, _conf, q = lift_sequence(
        kp,
        {"focalLengthPx": FOCAL * lift_focal_scale, "principalPointPx": [W / 2.0, H / 2.0]},
        W, H, **lift_kw,
    )
    elapsed = time.perf_counter() - t0

    errs: dict[str, list[float]] = {}
    for t in range(frames):
        if not np.isfinite(lifted[t][[KP[n] for n in (
            "left_hip", "left_knee", "left_ankle", "right_hip", "right_knee",
            "right_ankle", "left_shoulder", "right_shoulder")]]).all():
            continue
        ta, la = angles(truth[t]), angles(lifted[t])
        for k in ta:
            if math.isnan(ta[k]) or math.isnan(la[k]):
                continue
            errs.setdefault(k, []).append(abs(ta[k] - la[k]))

    solved = len(next(iter(errs.values()))) if errs else 0
    mae = {k: float(np.mean(v)) for k, v in errs.items()}
    joint_mae = float(np.mean([v for vals in errs.values() for v in vals])) if errs else math.nan
    return {
        "yaw": yaw_deg, "solved": solved, "frames": frames,
        "knee": float(np.mean([mae.get("left_knee", math.nan), mae.get("right_knee", math.nan)])),
        "hip": float(np.mean([mae.get("left_hip", math.nan), mae.get("right_hip", math.nan)])),
        "trunk": mae.get("trunk_lean", math.nan),
        "all": joint_mae,
        "reconConf": float(q.get("reconConf", math.nan)),
        "sec": elapsed,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--noise-px", type=float, default=0.0)
    ap.add_argument("--yaws", type=float, nargs="*",
                    default=[0.0, 20.0, 35.0, 50.0, 70.0, 90.0])
    ap.add_argument("--focal-error", type=float, default=1.0,
                    help="Scale the focal length HANDED TO THE LIFT, to measure "
                         "sensitivity to a mis-estimated camera (1.0 = exact).")
    args = ap.parse_args()

    print(f"frames={args.frames}  noise={args.noise_px}px  focal-error={args.focal_error:g}x")
    print(f"{'yaw':>5} {'solved':>7} {'knee':>7} {'hip':>7} {'trunk':>7} {'all':>7} "
          f"{'recon':>6} {'sec':>6}")
    print("-" * 60)
    rows = []
    for yaw in args.yaws:
        r = bench(yaw, args.frames, args.noise_px, args.focal_error)
        rows.append(r)
        print(f"{r['yaw']:>5.0f} {r['solved']:>3}/{r['frames']:<3} {r['knee']:>7.2f} "
              f"{r['hip']:>7.2f} {r['trunk']:>7.2f} {r['all']:>7.2f} "
              f"{r['reconConf']:>6.2f} {r['sec']:>6.2f}")
    ok = [r["all"] for r in rows if not math.isnan(r["all"])]
    if ok:
        print("-" * 60)
        print(f"mean joint-angle MAE across sweep: {np.mean(ok):.2f} deg")


if __name__ == "__main__":
    main()
