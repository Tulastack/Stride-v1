/**
 * PROMPT B.1 keystone — the view-invariance proof.
 *
 * Canonicalization must make the SAME motion filmed from two camera angles
 * produce the same canonical-frame angle curves (within tolerance). This is the
 * differentiator competitors structurally cannot do.
 */
import { rotateYaw, type Vec3 } from '../math.js';
import { canonicalize } from '../stage4_canonicalize.js';
import { trunkLeanDeg, thighElevationDeg } from '../stage5_metrics.js';
import { sideAccelClip } from '../precomputed.js';
import type { Pose3D } from '../types.js';

function rotatePose(pose: Pose3D, yaw: number): Pose3D {
  const out = {} as Pose3D;
  for (const k of Object.keys(pose) as (keyof Pose3D)[]) out[k] = rotateYaw(pose[k], yaw);
  return out;
}

describe('Stage 4 canonicalization is view-invariant', () => {
  const frames = sideAccelClip.frames;

  it('produces identical canonical trunk-lean regardless of camera yaw', () => {
    for (const yaw of [0.3, 1.1, -0.7, Math.PI / 2]) {
      for (const f of frames) {
        const a = trunkLeanDeg(canonicalize(f.pose));
        const b = trunkLeanDeg(canonicalize(rotatePose(f.pose, yaw)));
        expect(Math.abs(a - b)).toBeLessThan(0.5);
      }
    }
  });

  it('produces identical canonical thigh-elevation regardless of camera yaw', () => {
    const yaw = 1.0;
    for (const f of frames) {
      for (const side of ['l', 'r'] as const) {
        const a = thighElevationDeg(canonicalize(f.pose), side);
        const b = thighElevationDeg(canonicalize(rotatePose(f.pose, yaw)), side);
        expect(Math.abs(a - b)).toBeLessThan(0.5);
      }
    }
  });

  it('control: a NON-canonical (raw world-Z) trunk angle DOES change under yaw', () => {
    // Proves the invariance above is real work, not a tautology.
    const rawWorldTrunkZ = (pose: Pose3D): number => {
      const mids: Vec3 = [
        (pose.l_shoulder[0] + pose.r_shoulder[0]) / 2 - (pose.l_hip[0] + pose.r_hip[0]) / 2,
        (pose.l_shoulder[1] + pose.r_shoulder[1]) / 2 - (pose.l_hip[1] + pose.r_hip[1]) / 2,
        (pose.l_shoulder[2] + pose.r_shoulder[2]) / 2 - (pose.l_hip[2] + pose.r_hip[2]) / 2,
      ];
      return (Math.atan2(mids[2], mids[1]) * 180) / Math.PI; // uses world Z, not canonical forward
    };
    const f = frames[5];
    const a = rawWorldTrunkZ(f.pose);
    const b = rawWorldTrunkZ(rotatePose(f.pose, Math.PI / 2));
    expect(Math.abs(a - b)).toBeGreaterThan(5);
  });
});
