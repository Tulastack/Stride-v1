// Side-view sprint model for the post-analysis "how it should look" loop.
//
// This is a kinematic figure, not a generated image. Joint angles that fell
// outside their healthy band are pulled to the middle of that band so the
// runner sees the shape to aim for. Metrics that do not change a side-view
// silhouette (stance width, crossover) leave the figure alone.

import { metricLabel, type Metric } from '../types/analysis';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TargetSpec {
  /** Degrees forward from upright. Positive leans the chest toward the finish. */
  trunkLeanDeg: number;
  /** Swing-thigh angle at the top of the drive, degrees forward of straight down. */
  kneeDriveDeg: number;
  /** How far the trail thigh reaches behind the hip, degrees. */
  trailDeg: number;
  /** Metric keys whose ideal midpoint replaced the measured value. */
  adjusted: string[];
}

export type JointName =
  | 'head'
  | 'neck'
  | 'shoulderL'
  | 'shoulderR'
  | 'elbowL'
  | 'elbowR'
  | 'wristL'
  | 'wristR'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'
  | 'ankleL'
  | 'ankleR';

export interface Joint extends Vec3 {
  name: JointName;
}

export const BONES: [JointName, JointName][] = [
  ['neck', 'head'],
  ['shoulderL', 'shoulderR'],
  ['shoulderL', 'hipL'],
  ['shoulderR', 'hipR'],
  ['hipL', 'hipR'],
  ['shoulderL', 'elbowL'],
  ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'],
  ['elbowR', 'wristR'],
  ['hipL', 'kneeL'],
  ['kneeL', 'ankleL'],
  ['hipR', 'kneeR'],
  ['kneeR', 'ankleR'],
];

const THIGH = 0.42;
const SHANK = 0.4;
const UPPER_ARM = 0.28;
const FOREARM = 0.25;

const DEFAULT_SPEC: Omit<TargetSpec, 'adjusted'> = {
  trunkLeanDeg: 8,
  kneeDriveDeg: 92,
  trailDeg: 22,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function outside(value: number, range: [number, number]): boolean {
  return value < range[0] || value > range[1];
}

/** Build the pose the figure should hold, from the analysis ranges. */
export function idealSpec(metrics: Metric[]): TargetSpec {
  const spec: TargetSpec = { ...DEFAULT_SPEC, adjusted: [] };
  for (const m of metrics) {
    if (!m.normalRange) continue;
    const mid = (m.normalRange[0] + m.normalRange[1]) / 2;
    const off = outside(m.measured.value, m.normalRange);
    if (m.key === 'trunk_lean') {
      spec.trunkLeanDeg = clamp(mid, -8, 55);
      if (off) spec.adjusted.push(m.key);
    } else if (m.key === 'knee_drive') {
      spec.kneeDriveDeg = clamp(mid, 55, 115);
      if (off) spec.adjusted.push(m.key);
    } else if (m.key === 'hip_extension') {
      spec.trailDeg = clamp((mid - 145) * 0.55, 8, 32);
      if (off) spec.adjusted.push(m.key);
    }
  }
  return spec;
}

export function targetCaption(spec: TargetSpec, metrics: Metric[]): string {
  const off = metrics.filter(
    (m) => m.normalRange && outside(m.measured.value, m.normalRange),
  );
  if (spec.adjusted.length === 0 && off.length === 0) {
    return 'A clean stride. Everything measured sat inside its range.';
  }
  if (spec.adjusted.length === 0) {
    return 'A model of a sound sprint stride. The metrics that are off do not change this side view.';
  }
  const names = spec.adjusted.map((k) => metricLabel(k).toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Shaped around ${list}. A model of the target, not a picture of you.`;
}

function legAngles(phase: number, spec: TargetSpec): { thigh: number; flex: number } {
  const p = ((phase % 1) + 1) % 1;
  const swingEnd = 0.62;
  if (p < swingEnd) {
    const u = smoothstep(p / swingEnd);
    const thigh = -spec.trailDeg + (spec.kneeDriveDeg + spec.trailDeg) * u;
    const flex = 25 + 90 * Math.sin(Math.PI * u);
    return { thigh, flex };
  }
  const u = smoothstep((p - swingEnd) / (1 - swingEnd));
  const thigh = spec.kneeDriveDeg + (-spec.trailDeg - spec.kneeDriveDeg) * u;
  const flex = 70 * (1 - u) + 12;
  return { thigh, flex };
}

function chain(
  hip: Vec3,
  thighDeg: number,
  flexDeg: number,
): { knee: Vec3; ankle: Vec3 } {
  const thigh = (thighDeg * Math.PI) / 180;
  const knee = {
    x: hip.x + Math.sin(thigh) * THIGH,
    y: hip.y - Math.cos(thigh) * THIGH,
    z: hip.z,
  };
  const shank = ((thighDeg - flexDeg) * Math.PI) / 180;
  const ankle = {
    x: knee.x + Math.sin(shank) * SHANK,
    y: knee.y - Math.cos(shank) * SHANK,
    z: knee.z,
  };
  return { knee, ankle };
}

function leanAround(origin: Vec3, p: Vec3, leanDeg: number): Vec3 {
  const rad = (leanDeg * Math.PI) / 180;
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: origin.x + dx * c + dy * s,
    y: origin.y - dx * s + dy * c,
    z: p.z,
  };
}

function arm(shoulder: Vec3, swing: number): { elbow: Vec3; wrist: Vec3 } {
  const sh = (swing * Math.PI) / 180;
  const elbow = {
    x: shoulder.x + Math.sin(sh) * UPPER_ARM,
    y: shoulder.y - Math.cos(sh) * UPPER_ARM,
    z: shoulder.z,
  };
  const wrist = {
    x: elbow.x + Math.sin(sh) * FOREARM * 0.2,
    y: elbow.y - FOREARM * 0.95,
    z: elbow.z,
  };
  return { elbow, wrist };
}

/** One frame of the loop. `phase` is 0..1 through a full stride. */
export function poseAt(phase: number, spec: TargetSpec): Joint[] {
  const hipCenter: Vec3 = { x: 0, y: 0.94, z: 0 };
  const hipL: Vec3 = { x: 0, y: 0.94, z: -0.09 };
  const hipR: Vec3 = { x: 0, y: 0.94, z: 0.09 };

  const left = legAngles(phase, spec);
  const right = legAngles(phase + 0.5, spec);
  const legL = chain(hipL, left.thigh, left.flex);
  const legR = chain(hipR, right.thigh, right.flex);

  const shoulderL0: Vec3 = { x: 0, y: 1.42, z: -0.16 };
  const shoulderR0: Vec3 = { x: 0, y: 1.42, z: 0.16 };
  const shoulderL = leanAround(hipCenter, shoulderL0, spec.trunkLeanDeg);
  const shoulderR = leanAround(hipCenter, shoulderR0, spec.trunkLeanDeg);
  const shoulderMid = {
    x: (shoulderL.x + shoulderR.x) / 2,
    y: (shoulderL.y + shoulderR.y) / 2,
    z: 0,
  };
  const upLen = Math.hypot(shoulderMid.x - hipCenter.x, shoulderMid.y - hipCenter.y) || 1;
  const up = {
    x: (shoulderMid.x - hipCenter.x) / upLen,
    y: (shoulderMid.y - hipCenter.y) / upLen,
  };
  const neck: Vec3 = {
    x: shoulderMid.x + up.x * 0.06,
    y: shoulderMid.y + up.y * 0.06,
    z: 0,
  };
  const head: Vec3 = {
    x: shoulderMid.x + up.x * 0.2,
    y: shoulderMid.y + up.y * 0.2,
    z: 0,
  };

  // Arms oppose the same-side leg: forward thigh, back arm.
  const armL = arm(shoulderL, -32 * Math.sin(phase * Math.PI * 2));
  const armR = arm(shoulderR, -32 * Math.sin((phase + 0.5) * Math.PI * 2));

  const named: Joint[] = [
    { name: 'head', ...head },
    { name: 'neck', ...neck },
    { name: 'shoulderL', ...shoulderL },
    { name: 'shoulderR', ...shoulderR },
    { name: 'elbowL', ...armL.elbow },
    { name: 'elbowR', ...armR.elbow },
    { name: 'wristL', ...armL.wrist },
    { name: 'wristR', ...armR.wrist },
    { name: 'hipL', ...hipL },
    { name: 'hipR', ...hipR },
    { name: 'kneeL', ...legL.knee },
    { name: 'kneeR', ...legR.knee },
    { name: 'ankleL', ...legL.ankle },
    { name: 'ankleR', ...legR.ankle },
  ];
  return named;
}

/** Perspective from a slight three-quarter camera so the far leg reads as depth. */
export function projectJoint(
  p: Vec3,
  width: number,
  height: number,
): { x: number; y: number; depth: number } {
  const yaw = 0.62;
  const xr = p.x * Math.cos(yaw) - p.z * Math.sin(yaw);
  const zr = p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
  const depth = 3.6 - zr;
  const s = (height * 0.62) / depth;
  return {
    x: width * 0.52 + xr * s,
    y: height * 0.86 - p.y * s,
    depth,
  };
}
