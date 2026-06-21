// Minimal 3D vector math for the biomechanics engine. No external deps so it
// stays CPU-runnable in the reduced dev mode.

export type Vec3 = readonly [number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/** Angle between two vectors, in degrees (0..180). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const d = dot(norm(a), norm(b));
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

/** Rotate a point about the world up (Y) axis by yaw radians. Simulates filming
 *  the same motion from a different azimuth. */
export function rotateYaw(p: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

/** A 3x3 rotation expressed as three basis rows (right, up, forward). */
export type Basis = { right: Vec3; up: Vec3; forward: Vec3 };

/** Express a world point in the given orthonormal basis. */
export function toBasis(p: Vec3, basis: Basis): Vec3 {
  return [dot(p, basis.right), dot(p, basis.up), dot(p, basis.forward)];
}
