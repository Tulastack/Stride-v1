// Stage 2 — monocular 3D lift with gyro-based camera-motion decoupling.
//
// CPU-realizable path (not full WHAM/SMPL GPU fit): weak-perspective lift from
// 2D keypoints + anthropometric bone lengths, then subtract integrated gyro yaw
// so handheld camera motion does not contaminate body motion.

import type { CameraIntrinsics } from '@stride/types';
import type { CaptureManifest, GyroSample } from './capture/types.js';
import type { Frame3D, JointName, Keypoints2DFrame, Pose3D } from './types.js';
import { type Vec3, rotateYaw, sub, mid, len, norm, scale, add } from './math.js';

const JOINTS: JointName[] = [
  'head', 'neck', 'l_shoulder', 'r_shoulder', 'l_hip', 'r_hip',
  'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_toe', 'r_toe',
];

const BONE_LEN: Partial<Record<JointName, number>> = {
  neck: 0.18,
  l_shoulder: 0.18,
  r_shoulder: 0.18,
  l_hip: 0.45,
  r_hip: 0.45,
  l_knee: 0.43,
  r_knee: 0.43,
  l_ankle: 0.08,
  r_ankle: 0.08,
  l_toe: 0.12,
  r_toe: 0.12,
};

export interface LiftOutput {
  frames: Frame3D[];
  cameraAzimuthDeg: number;
  reconResidual: number;
}

function focalLength(manifest: CaptureManifest, intrinsics?: CameraIntrinsics): number {
  if (intrinsics?.focalLengthPx) return intrinsics.focalLengthPx;
  return manifest.widthPx * 0.9;
}

function principal(intrinsics: CameraIntrinsics | undefined, manifest: CaptureManifest): [number, number] {
  if (intrinsics) return intrinsics.principalPointPx;
  return [manifest.widthPx / 2, manifest.heightPx / 2];
}

/** Integrate gyro yaw (world-up axis) between samples. */
function integratedYaw(gyro: GyroSample[], tMs: number): number {
  if (gyro.length === 0) return 0;
  let yaw = 0;
  let prev = gyro[0];
  for (const g of gyro) {
    if (g.timestampMs > tMs) break;
    const dt = (g.timestampMs - prev.timestampMs) / 1000;
    if (dt > 0) yaw += g.wy * dt; // device Y ~ vertical when portrait
    prev = g;
  }
  return yaw;
}

function liftFrame(
  kp: Keypoints2DFrame,
  depthScale: number,
  fx: number,
  cx: number,
  cy: number,
  widthPx: number,
  heightPx: number
): Pose3D {
  const pose = {} as Pose3D;
  const to3 = (xNorm: number, yNorm: number, z: number): Vec3 => {
    const px = xNorm * widthPx;
    const py = yNorm * heightPx;
    const X = ((px - cx) * z) / fx;
    const Y = ((py - cy) * z) / fx;
    return [X, -Y, z];
  };

  for (const j of JOINTS) {
    const p = kp[j];
    if (!p) {
      pose[j] = [0, 0, 0];
      continue;
    }
    const z = depthScale * (0.9 + 0.2 * p.confidence);
    pose[j] = to3(p.x, p.y, z);
  }

  // Derive neck as shoulder midpoint if missing
  if (!kp.neck && kp.l_shoulder && kp.r_shoulder) {
    pose.neck = mid(pose.l_shoulder, pose.r_shoulder);
  }

  return pose;
}

/** Apply bone-length constraints (Stage 3 lite inline). */
function constrainBones(pose: Pose3D): { pose: Pose3D; residual: number } {
  let residual = 0;
  const out = { ...pose };
  const pairs: [JointName, JointName][] = [
    ['l_hip', 'l_knee'],
    ['r_hip', 'r_knee'],
    ['l_knee', 'l_ankle'],
    ['r_knee', 'r_ankle'],
    ['l_ankle', 'l_toe'],
    ['r_ankle', 'r_toe'],
  ];

  for (const [a, b] of pairs) {
    const target = BONE_LEN[b] ?? 0.4;
    const v = sub(out[b], out[a]);
    const L = len(v);
    if (L < 1e-6) continue;
    residual += Math.abs(L - target);
    out[b] = add(out[a], scale(norm(v), target));
  }

  return { pose: out, residual: residual / pairs.length };
}

export function monocularLift3D(
  keypoints: Keypoints2DFrame[],
  fps: number,
  manifest: CaptureManifest
): LiftOutput {
  const fx = focalLength(manifest, manifest.intrinsics);
  const [cx, cy] = principal(manifest.intrinsics, manifest);
  const frames: Frame3D[] = [];

  // Depth from apparent hip width (wider in image → closer / more side-on).
  let avgHipW = 0;
  let hc = 0;
  for (const f of keypoints) {
    if (f.l_hip && f.r_hip) {
      avgHipW += Math.abs(f.r_hip.x - f.l_hip.x);
      hc++;
    }
  }
  avgHipW = hc ? avgHipW / hc : 0.2;
  const depthScale = 2.2 / Math.max(avgHipW, 0.06);

  let totalResidual = 0;
  for (let i = 0; i < keypoints.length; i++) {
    const tMs = Math.round((i / fps) * 1000);
    let pose = liftFrame(keypoints[i], depthScale, fx, cx, cy, manifest.widthPx, manifest.heightPx);

    // Gyro decoupling: rotate world observation by inverse camera yaw.
    const camYaw = integratedYaw(manifest.gyro, tMs);
    const decoupled = {} as Pose3D;
    for (const j of JOINTS) {
      decoupled[j] = rotateYaw(pose[j], -camYaw);
    }

    const { pose: fitted, residual } = constrainBones(decoupled);
    totalResidual += residual;

    const confs = Object.values(keypoints[i])
      .filter(Boolean)
      .map((k) => k!.confidence);
    const keypointConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;

    frames.push({
      timestampMs: tMs,
      pose: fitted,
      keypointConfidence,
      reconResidual: Math.min(1, residual / 0.15),
    });
  }

  const cameraAzimuthDeg =
    manifest.cameraAzimuthDeg ??
    Math.min(89, Math.max(0, (1 - avgHipW / 0.24) * 90));

  return {
    frames,
    cameraAzimuthDeg,
    reconResidual: frames.length ? totalResidual / frames.length : 0.5,
  };
}
