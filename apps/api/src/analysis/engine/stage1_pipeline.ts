// Stage 1 orchestration — run hygiene end-to-end on per-joint time series.
import type { JointName, Keypoint2D, Keypoints2DFrame } from './types.js';
import { dropLowConfidence, gapFill, lowPass, meanConfidence } from './stage1_keypoints.js';

const JOINTS: JointName[] = [
  'head', 'neck', 'l_shoulder', 'r_shoulder', 'l_hip', 'r_hip',
  'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_toe', 'r_toe',
];

export interface Stage1Output {
  frames: Keypoints2DFrame[];
  fps: number;
  meanKeypointConfidence: number;
}

/** Apply Van Hooren-style hygiene across the clip. */
export function runStage1Hygiene(rawFrames: Keypoints2DFrame[], fps: number): Stage1Output {
  const n = rawFrames.length;
  if (n === 0) return { frames: [], fps, meanKeypointConfidence: 0 };

  const cleaned: Keypoints2DFrame[] = Array.from({ length: n }, () => ({}));

  for (const joint of JOINTS) {
    const xs: (number | null)[] = [];
    const ys: (number | null)[] = [];
    const cs: (number | null)[] = [];
    const dropped = dropLowConfidence(
      rawFrames.map((f) => f[joint] ?? null)
    );

    for (const k of dropped) {
      xs.push(k?.x ?? null);
      ys.push(k?.y ?? null);
      cs.push(k?.confidence ?? null);
    }

    const fx = lowPass(gapFill(xs));
    const fy = lowPass(gapFill(ys));
    const fc = lowPass(gapFill(cs));

    for (let i = 0; i < n; i++) {
      cleaned[i][joint] = { x: fx[i], y: fy[i], confidence: Math.max(0, Math.min(1, fc[i])) };
    }
  }

  const confs = cleaned.map((f) => meanConfidence(f));
  const meanKeypointConfidence = confs.reduce((a, b) => a + b, 0) / confs.length;

  return { frames: cleaned, fps, meanKeypointConfidence };
}

/** Estimate camera azimuth from average shoulder–hip width ratio in image space. */
export function estimateCameraAzimuth(frames: Keypoints2DFrame[]): number {
  let sumRatio = 0;
  let count = 0;
  for (const f of frames) {
    const ls = f.l_shoulder;
    const rs = f.r_shoulder;
    const lh = f.l_hip;
    const rh = f.r_hip;
    if (!ls || !rs || !lh || !rh) continue;
    const shoulderW = Math.abs(rs.x - ls.x);
    const hipW = Math.abs(rh.x - lh.x);
    if (shoulderW < 1e-4) continue;
    sumRatio += hipW / shoulderW;
    count++;
  }
  if (count === 0) return 30;
  const ratio = sumRatio / count;
  // side-on ~1.0, head-on ratio approaches 0
  const azimuth = Math.acos(Math.max(0, Math.min(1, ratio))) * (180 / Math.PI);
  return Math.round(azimuth * 10) / 10;
}
