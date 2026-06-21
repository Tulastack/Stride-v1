// Stage 5 — gait events + canonical joint/segment angles + metrics.
// All angles are read in the canonical frame (Stage 4) so they are view-invariant.

import { type Vec3, sub, mid, angleBetween } from './math.js';
import type { Frame3D, CanonicalPose } from './types.js';
import { canonicalize } from './stage4_canonicalize.js';

const DOWN: Vec3 = [0, -1, 0];
const VERT: Vec3 = [0, 1, 0];

/** Forward trunk lean from vertical, degrees (positive = leaning forward). */
export function trunkLeanDeg(c: CanonicalPose): number {
  const spine = sub(mid(c.l_shoulder, c.r_shoulder), [0, 0, 0]); // pelvis is origin
  return (Math.atan2(spine[2], spine[1]) * 180) / Math.PI;
}

/** Thigh elevation above straight-down (0 = hanging, ~90 = knee at hip height). */
export function thighElevationDeg(c: CanonicalPose, side: 'l' | 'r'): number {
  const hip = side === 'l' ? c.l_hip : c.r_hip;
  const knee = side === 'l' ? c.l_knee : c.r_knee;
  return angleBetween(sub(knee, hip), DOWN);
}

/** Is the thigh trailing behind the body (forward component negative)? */
function thighForward(c: CanonicalPose, side: 'l' | 'r'): number {
  const hip = side === 'l' ? c.l_hip : c.r_hip;
  const knee = side === 'l' ? c.l_knee : c.r_knee;
  return sub(knee, hip)[2];
}

export type MetricPlane = 'sagittal' | 'temporal';

export interface ComputedMetric {
  key: string;
  value: number;
  unit: string;
  normalRange: [number, number];
  plane: MetricPlane;
  /** Index of the most representative frame (for the evidence anchor). */
  evidenceFrame: number;
}

export interface Stance {
  side: 'l' | 'r';
  strikeIdx: number;
  offIdx: number;
}

/** Detect ground-contact stances from world-frame ankle height. */
export function detectStances(frames: Frame3D[], side: 'l' | 'r'): Stance[] {
  const ankle = side === 'l' ? 'l_ankle' : 'r_ankle';
  const ys = frames.map((f) => f.pose[ankle][1]);
  const ground = Math.min(...ys);
  const peak = Math.max(...ys);
  const threshold = ground + (peak - ground) * 0.18;

  const stances: Stance[] = [];
  let start = -1;
  for (let i = 0; i < ys.length; i++) {
    const contact = ys[i] <= threshold;
    if (contact && start === -1) start = i;
    if (!contact && start !== -1) {
      stances.push({ side, strikeIdx: start, offIdx: i - 1 });
      start = -1;
    }
  }
  if (start !== -1) stances.push({ side, strikeIdx: start, offIdx: ys.length - 1 });
  return stances;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export interface Stage5Output {
  canonical: CanonicalPose[];
  metrics: ComputedMetric[];
  stances: Stance[];
}

export function computeMetrics(frames: Frame3D[], fps: number): Stage5Output {
  const canonical = frames.map((f) => canonicalize(f.pose));

  // ─ trunk lean (mean over the clip) ─
  const trunkSeries = canonical.map(trunkLeanDeg);
  const trunkMean = mean(trunkSeries);
  // most representative trunk frame = closest to the mean
  const trunkFrame = trunkSeries
    .map((v, i) => [Math.abs(v - trunkMean), i] as const)
    .sort((a, b) => a[0] - b[0])[0][1];

  // ─ peak knee drive (max thigh elevation, either leg) ─
  let kneeDrive = 0;
  let kneeFrame = 0;
  canonical.forEach((c, i) => {
    for (const side of ['l', 'r'] as const) {
      const e = thighElevationDeg(c, side);
      if (e > kneeDrive) {
        kneeDrive = e;
        kneeFrame = i;
      }
    }
  });

  // ─ peak hip extension (max thigh elevation while trailing) ─
  let hipExt = 0;
  let hipFrame = 0;
  canonical.forEach((c, i) => {
    for (const side of ['l', 'r'] as const) {
      if (thighForward(c, side) < 0) {
        const e = thighElevationDeg(c, side);
        if (e > hipExt) {
          hipExt = e;
          hipFrame = i;
        }
      }
    }
  });

  // ─ gait events -> contact time + cadence ─
  const stances = [...detectStances(frames, 'l'), ...detectStances(frames, 'r')].sort(
    (a, b) => a.strikeIdx - b.strikeIdx
  );
  const validStances = stances.filter((s) => s.offIdx > s.strikeIdx);
  const contactTimesMs = validStances.map((s) => ((s.offIdx - s.strikeIdx) / fps) * 1000);
  const contactTime = mean(contactTimesMs);
  const uniqueStrikeIdx = [...new Set(validStances.map((s) => s.strikeIdx))].sort((a, b) => a - b);
  const strikeTimes = uniqueStrikeIdx.map((idx) => idx / fps);
  const stepIntervals: number[] = [];
  for (let i = 1; i < strikeTimes.length; i++) {
    const dt = strikeTimes[i] - strikeTimes[i - 1];
    if (dt > 1 / fps) stepIntervals.push(dt);
  }
  const cadence =
    stepIntervals.length && mean(stepIntervals) > 0 ? 60 / mean(stepIntervals) : 0;

  const metrics: ComputedMetric[] = [
    { key: 'trunk_lean', value: round(trunkMean), unit: 'deg', normalRange: [38, 50], plane: 'sagittal', evidenceFrame: trunkFrame },
    { key: 'knee_drive', value: round(kneeDrive), unit: 'deg', normalRange: [60, 85], plane: 'sagittal', evidenceFrame: kneeFrame },
    { key: 'hip_extension', value: round(hipExt), unit: 'deg', normalRange: [35, 55], plane: 'sagittal', evidenceFrame: hipFrame },
    { key: 'contact_time_ms', value: round(contactTime), unit: 'ms', normalRange: [80, 110], plane: 'temporal', evidenceFrame: validStances[0]?.strikeIdx ?? 0 },
    { key: 'cadence_spm', value: round(cadence), unit: 'spm', normalRange: [160, 200], plane: 'temporal', evidenceFrame: 0 },
  ];

  return { canonical, metrics, stances };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 0);
