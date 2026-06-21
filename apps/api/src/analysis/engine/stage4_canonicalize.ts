// Stage 4 — canonicalize into a pelvis-centric, gravity-aligned body frame.
//
// THIS is what makes Stride's angles view-invariant: regardless of camera
// azimuth, we re-express the body in its own frame (pelvis origin, lateral axis
// from the hips, gravity up, facing forward). All reported angles are computed
// here, so uploads from any angle are directly comparable.

import { type Vec3, sub, cross, dot, norm, mid, scale, toBasis, type Basis } from './math.js';
import type { Pose3D, CanonicalPose } from './types.js';

const WORLD_UP: Vec3 = [0, 1, 0];

/** Build the body-centric orthonormal basis from a world-frame pose. */
export function bodyBasis(pose: Pose3D): { origin: Vec3; basis: Basis } {
  const origin = mid(pose.l_hip, pose.r_hip);

  // Lateral axis from hips, flattened to horizontal (remove gravity component).
  const rightRaw = sub(pose.r_hip, pose.l_hip);
  const right = norm(sub(rightRaw, scale(WORLD_UP, dot(rightRaw, WORLD_UP))));

  // Forward (facing) is horizontal, perpendicular to lateral and up.
  const forward = norm(cross(WORLD_UP, right));

  // Re-orthogonalize up so the basis is exact.
  const up = norm(cross(right, forward));

  return { origin, basis: { right, up, forward } };
}

/** Express every joint in the canonical body frame. */
export function canonicalize(pose: Pose3D): CanonicalPose {
  const { origin, basis } = bodyBasis(pose);
  const out = {} as CanonicalPose;
  for (const key of Object.keys(pose) as (keyof Pose3D)[]) {
    out[key] = toBasis(sub(pose[key], origin), basis);
  }
  return out;
}
