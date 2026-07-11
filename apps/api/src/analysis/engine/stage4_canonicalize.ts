// Stage 4 — canonicalize into a pelvis-centric, gravity-aligned body frame.
//
// THIS is what makes Stride's angles view-invariant: regardless of camera
// azimuth, we re-express the body in its own frame (pelvis origin, lateral axis
// from the hips, gravity up, facing forward). All reported angles are computed
// here, so uploads from any angle are directly comparable.

import { type Vec3, sub, cross, dot, norm, mid, scale, len, toBasis, type Basis } from './math.js';
import type { Pose3D, CanonicalPose } from './types.js';

const WORLD_UP: Vec3 = [0, 1, 0];

/** Resolve the up axis, falling back to vertical for absent/degenerate input. */
function resolveUp(worldUp?: Vec3): Vec3 {
  if (!worldUp) return WORLD_UP;
  const u = norm(worldUp);
  return len(u) < 1e-6 ? WORLD_UP : u;
}

/**
 * Build the body-centric orthonormal basis from a world-frame pose.
 *
 * `worldUp` is the true vertical expressed in the pose's own frame. Default is
 * [0,1,0] (assume the reconstruction is already gravity-aligned). Passing a
 * MEASURED gravity up (from the phone IMU) makes the canonical frame — and every
 * angle read from it — invariant to camera pitch/roll/elevation, not just yaw:
 * bodyBasis(R·pose, R·up) and bodyBasis(pose, up) yield the same canonical
 * angles for any rotation R.
 */
export function bodyBasis(pose: Pose3D, worldUp?: Vec3): { origin: Vec3; basis: Basis } {
  const up0 = resolveUp(worldUp);
  const origin = mid(pose.l_hip, pose.r_hip);

  // Lateral axis from hips, flattened to horizontal (remove gravity component).
  const rightRaw = sub(pose.r_hip, pose.l_hip);
  const right = norm(sub(rightRaw, scale(up0, dot(rightRaw, up0))));

  // Forward (facing) is horizontal, perpendicular to lateral and up.
  const forward = norm(cross(up0, right));

  // Re-orthogonalize up so the basis is exact.
  const up = norm(cross(right, forward));

  return { origin, basis: { right, up, forward } };
}

/** Express every joint in the canonical body frame. */
export function canonicalize(pose: Pose3D, worldUp?: Vec3): CanonicalPose {
  const { origin, basis } = bodyBasis(pose, worldUp);
  const out = {} as CanonicalPose;
  for (const key of Object.keys(pose) as (keyof Pose3D)[]) {
    out[key] = toBasis(sub(pose[key], origin), basis);
  }
  return out;
}
