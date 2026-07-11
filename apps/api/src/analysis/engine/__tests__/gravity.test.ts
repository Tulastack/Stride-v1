/**
 * Research Phase 1 — gravity anchoring.
 *
 * Two things are proven here:
 *  1. The gyro+accel complementary filter recovers a stable gravity direction
 *     and REJECTS transient linear-acceleration spikes (the panning-filmer case).
 *  2. Feeding a measured world-up into Stage 4 canonicalization extends its
 *     view-invariance from yaw-only to full pitch/roll/elevation — while leaving
 *     the default (no gravity) behavior byte-identical.
 */
import { fuseGravity, worldUpFromGravity, tiltFromVerticalDeg } from '../gravity.js';
import { canonicalize } from '../stage4_canonicalize.js';
import { trunkLeanDeg, thighElevationDeg } from '../stage5_metrics.js';
import { sideAccelClip } from '../precomputed.js';
import { type Vec3, norm } from '../math.js';
import type { AccelSample, GyroSample } from '../capture/types.js';
import type { Pose3D } from '../types.js';

const G = 9.80665;

function accelSeries(dir: Vec3, n: number, jitter = 0): AccelSample[] {
  const u = norm(dir);
  return Array.from({ length: n }, (_, i) => ({
    timestampMs: i * 10,
    ax: u[0] * G + (i % 2 ? jitter : -jitter),
    ay: u[1] * G + (i % 3 ? -jitter : jitter),
    az: u[2] * G,
  }));
}
const noGyro = (n: number): GyroSample[] =>
  Array.from({ length: n }, (_, i) => ({ timestampMs: i * 10, wx: 0, wy: 0, wz: 0 }));

describe('gyro+accel gravity fusion', () => {
  it('recovers the gravity direction from a steady, upright accelerometer', () => {
    const n = 40;
    const res = fuseGravity(accelSeries([0, 1, 0], n, 0.2), noGyro(n));
    expect(res).not.toBeNull();
    expect(res!.mean[1]).toBeGreaterThan(0.99); // ~[0,1,0]
    expect(Math.hypot(res!.mean[0], res!.mean[2])).toBeLessThan(0.05);
  });

  it('rejects a transient linear-acceleration spike (the panning filmer)', () => {
    const n = 40;
    const accel = accelSeries([0, 1, 0], n);
    // A hard sideways jerk mid-clip: magnitude far from 1 g on the X axis.
    accel[20] = { timestampMs: 200, ax: 6 * G, ay: G, az: 0 };
    accel[21] = { timestampMs: 210, ax: 6 * G, ay: G, az: 0 };
    const res = fuseGravity(accel, noGyro(n))!;
    // Down-weighted: the spike must not drag "up" appreciably toward +X.
    expect(res.mean[0]).toBeLessThan(0.1);
    expect(res.mean[1]).toBeGreaterThan(0.99);
  });

  it('returns null when there is no accelerometer data', () => {
    expect(fuseGravity([], noGyro(3))).toBeNull();
  });

  it('worldUpFromGravity flips a down-pointing gravity to up', () => {
    expect(worldUpFromGravity([0, -1, 0])[1]).toBeCloseTo(1, 6);
  });

  it('tiltFromVerticalDeg measures deviation from vertical', () => {
    expect(tiltFromVerticalDeg([0, 1, 0])).toBeCloseTo(0, 5);
    expect(tiltFromVerticalDeg([1, 1, 0])).toBeCloseTo(45, 4);
  });
});

// Rotate a pose about the X axis (camera pitch / elevation) — the NON-yaw
// tilt that the old hardcoded [0,1,0] up cannot handle.
function rotX(p: Vec3, t: number): Vec3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
}
function rotPoseX(pose: Pose3D, t: number): Pose3D {
  const out = {} as Pose3D;
  for (const k of Object.keys(pose) as (keyof Pose3D)[]) out[k] = rotX(pose[k], t);
  return out;
}

describe('gravity-anchored canonicalization is pitch/roll invariant', () => {
  const frames = sideAccelClip.frames;

  it('recovers the same trunk lean under camera pitch when given measured up', () => {
    for (const t of [0.25, -0.4, 0.6]) {
      const up: Vec3 = rotX([0, 1, 0], t); // true vertical, expressed in the tilted frame
      for (const f of frames) {
        const base = trunkLeanDeg(canonicalize(f.pose)); // level camera, default up
        const tilted = trunkLeanDeg(canonicalize(rotPoseX(f.pose, t), up));
        expect(Math.abs(base - tilted)).toBeLessThan(0.5);
      }
    }
  });

  it('recovers the same thigh elevation under camera pitch when given measured up', () => {
    const t = 0.5;
    const up: Vec3 = rotX([0, 1, 0], t);
    for (const f of frames) {
      for (const side of ['l', 'r'] as const) {
        const base = thighElevationDeg(canonicalize(f.pose), side);
        const tilted = thighElevationDeg(canonicalize(rotPoseX(f.pose, t), up), side);
        expect(Math.abs(base - tilted)).toBeLessThan(0.5);
      }
    }
  });

  it('control: WITHOUT the measured up, camera pitch corrupts the angle', () => {
    // Proves the gravity correction is doing real work, not a tautology.
    const t = 0.5;
    const f = frames[5];
    const base = trunkLeanDeg(canonicalize(f.pose));
    const naive = trunkLeanDeg(canonicalize(rotPoseX(f.pose, t))); // default [0,1,0], wrong under tilt
    expect(Math.abs(base - naive)).toBeGreaterThan(3);
  });

  it('default behavior (no worldUp) is unchanged', () => {
    for (const f of frames) {
      const a = canonicalize(f.pose);
      const b = canonicalize(f.pose, [0, 1, 0]);
      for (const k of Object.keys(a) as (keyof typeof a)[]) {
        expect(a[k][0]).toBeCloseTo(b[k][0], 9);
        expect(a[k][1]).toBeCloseTo(b[k][1], 9);
        expect(a[k][2]).toBeCloseTo(b[k][2], 9);
      }
    }
  });
});
