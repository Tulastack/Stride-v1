// Gyro+accelerometer gravity fusion (research Phase 1 — "anchor to gravity,
// don't infer up").
//
// A phone accelerometer measures gravity PLUS the filmer's own linear
// acceleration. When you pan to track a 3–5 m/s runner, a naive low-pass of the
// accelerometer bleeds that pan-acceleration into "down" exactly when it matters
// most. A complementary filter avoids that: it propagates the gravity direction
// with the gyro (which is unaffected by linear acceleration) and only trusts the
// accelerometer to correct slow drift, AND only when the accelerometer magnitude
// is close to 1 g (i.e. the phone is not being jerked). The output is a stable
// unit direction of the measured gravity vector; the capture layer maps it into
// the pose frame (applying platform sign + device extrinsics) to get world-up.
//
// NOTE ON FRAMES: samples are in the DEVICE frame. Mapping device gravity into
// the reconstruction's world frame is a calibrated step (research Phase 0) — the
// engine consumes an already-in-world-frame `gravityWorld` on the capture
// manifest; this module is the tool a capture layer uses to produce it.

import { type Vec3, cross, norm, add, scale, len, dot } from './math.js';
import type { AccelSample, GyroSample } from './capture/types.js';

const G = 9.80665; // m/s^2

export interface GravityFusionOptions {
  /** Base correction gain toward the accelerometer when it reads ~1 g (0..1). */
  alpha?: number;
  /** Tolerance band (fraction of g) within which the accelerometer is trusted. */
  trustBand?: number;
}

export interface GravityFusionResult {
  /**
   * Per-accel-sample stabilized unit direction of the measured accelerometer
   * vector, device frame. This is convention-neutral: it points wherever the
   * platform's accelerometer/gravity vector points (up on Android TYPE_GRAVITY,
   * down on some iOS conventions). Apply your platform's sign + the device→pose
   * extrinsic to get the world-up Stage 4 wants.
   */
  perSample: Vec3[];
  /** Robust mean of `perSample` (device frame). */
  mean: Vec3;
}

/** Nearest gyro angular velocity (rad/s) at time `tMs`. */
function omegaAt(gyro: GyroSample[], tMs: number): Vec3 {
  if (gyro.length === 0) return [0, 0, 0];
  let best = gyro[0];
  let bestDist = Math.abs(gyro[0].timestampMs - tMs);
  for (const g of gyro) {
    const d = Math.abs(g.timestampMs - tMs);
    if (d < bestDist) {
      best = g;
      bestDist = d;
    }
  }
  return [best.wx, best.wy, best.wz];
}

/**
 * Fuse accelerometer + gyro into a stable gravity direction. Returns null if
 * there is no accelerometer data to anchor on. Pure and allocation-light.
 */
export function fuseGravity(
  accel: AccelSample[],
  gyro: GyroSample[],
  opts: GravityFusionOptions = {},
): GravityFusionResult | null {
  if (!accel || accel.length === 0) return null;
  const alpha = opts.alpha ?? 0.05;
  const trustBand = opts.trustBand ?? 0.15;

  // Seed with the first accelerometer reading (best available prior).
  let g: Vec3 = norm([accel[0].ax, accel[0].ay, accel[0].az]);
  if (len(g) < 1e-6) g = [0, -1, 0]; // degenerate first sample → assume down

  const perSample: Vec3[] = [];
  let prevT = accel[0].timestampMs;

  for (const a of accel) {
    const dt = Math.max(0, (a.timestampMs - prevT) / 1000);
    prevT = a.timestampMs;

    // Gyro prediction: a world-fixed vector (gravity) rotates by -omega in the
    // device frame → dg/dt = -(omega × g). First-order integrate, renormalize.
    if (dt > 0) {
      const w = omegaAt(gyro, a.timestampMs);
      g = norm(add(g, scale(cross(w, g), -dt)));
    }

    // Accelerometer correction — only when it looks like mostly gravity.
    const aMag = Math.hypot(a.ax, a.ay, a.az);
    if (aMag > 1e-6) {
      const off = Math.abs(aMag - G) / G;
      const trust = Math.max(0, 1 - off / trustBand); // 1 at exactly 1g → 0 past band
      if (trust > 0) {
        const aDir = norm([a.ax, a.ay, a.az]); // measured accelerometer direction
        const k = alpha * trust;
        g = norm(add(scale(g, 1 - k), scale(aDir, k)));
      }
    }

    perSample.push(g);
  }

  // Robust-ish mean: average the stabilized per-sample directions.
  let acc: Vec3 = [0, 0, 0];
  for (const s of perSample) acc = add(acc, s);
  const mean = len(acc) > 1e-6 ? norm(acc) : perSample[perSample.length - 1];

  return { perSample, mean };
}

/** Convert a gravity ("down") direction into the world-up vector Stage 4 wants. */
export function worldUpFromGravity(down: Vec3): Vec3 {
  const up = scale(down, -1);
  return len(up) < 1e-6 ? [0, 1, 0] : norm(up);
}

/** Cosine tilt of a measured up from the assumed vertical, in degrees (0 = level). */
export function tiltFromVerticalDeg(up: Vec3): number {
  const u = norm(up);
  if (len(u) < 1e-6) return 0;
  const c = Math.max(-1, Math.min(1, dot(u, [0, 1, 0])));
  return (Math.acos(c) * 180) / Math.PI;
}
