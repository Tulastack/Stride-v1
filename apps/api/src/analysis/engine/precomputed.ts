// Reduced-dev-mode precomputed 3D clips (stand-in for SMPL output from the GPU
// lift+fit). A parametric sprint gait so the CPU pipeline has real motion to
// detect events and angles on. TODO(ml-phase): replace with real cached SMPL.

import type { Vec3 } from './math.js';
import type { Frame3D, Pose3D, PrecomputedClip } from './types.js';

const THIGH = 0.45;
const PELVIS_Y = 0.95;
const GROUND = 0.05;
const LIFT = 0.32;
const relu = (x: number) => Math.max(0, x);

/** Build one sprint-gait frame. `leanZ` controls forward trunk lean. */
function gaitFrame(i: number, n: number, fps: number, cycles: number, leanZ: number): Frame3D {
  const base = (2 * Math.PI * cycles * i) / n;
  const pelvis: Vec3 = [0, PELVIS_Y, 0];

  const leg = (side: 'l' | 'r'): { hip: Vec3; knee: Vec3; ankle: Vec3; toe: Vec3 } => {
    const phase = side === 'l' ? base : base + Math.PI;
    const lateral = side === 'l' ? -0.12 : 0.12;
    const theta = 0.8 * Math.sin(phase); // + = drive forward, - = trailing/extension
    const hip: Vec3 = [lateral, PELVIS_Y, 0];
    const knee: Vec3 = [lateral, PELVIS_Y - THIGH * Math.cos(theta), THIGH * Math.sin(theta)];
    const ankleY = GROUND + LIFT * relu(Math.sin(phase)); // foot up while driving, planted while trailing
    const ankle: Vec3 = [lateral, ankleY, knee[2] * 0.5];
    const toe: Vec3 = [lateral, ankleY, ankle[2] + 0.12];
    return { hip, knee, ankle, toe };
  };

  const l = leg('l');
  const r = leg('r');
  const midShoulder: Vec3 = [0, PELVIS_Y + 0.5, leanZ];
  const pose: Pose3D = {
    head: [0, PELVIS_Y + 0.78, leanZ * 1.3],
    neck: midShoulder,
    l_shoulder: [-0.18, PELVIS_Y + 0.5, leanZ],
    r_shoulder: [0.18, PELVIS_Y + 0.5, leanZ],
    l_hip: l.hip,
    r_hip: r.hip,
    l_knee: l.knee,
    r_knee: r.knee,
    l_ankle: l.ankle,
    r_ankle: r.ankle,
    l_toe: l.toe,
    r_toe: r.toe,
  };
  // pelvis var kept for clarity of origin
  void pelvis;
  return { timestampMs: Math.round((i / fps) * 1000), pose, keypointConfidence: 0, reconResidual: 0 };
}

function buildFrames(
  n: number,
  fps: number,
  cycles: number,
  leanZ: number,
  keypointConfidence: number,
  reconResidual: number
): Frame3D[] {
  return Array.from({ length: n }, (_, i) => {
    const f = gaitFrame(i, n, fps, cycles, leanZ);
    return { ...f, keypointConfidence, reconResidual };
  });
}

/** HIGH-quality side-on acceleration capture: trusted everywhere. */
export const sideAccelClip: PrecomputedClip = {
  clipId: 'precomp-side-accel',
  fps: 120,
  cameraAzimuthDeg: 0,
  framing: 'full',
  motionBlur: 'low',
  frames: buildFrames(48, 120, 4, 0.5, 0.9, 0.06), // leanZ=0.5 -> ~45° trunk lean
};

/** LOW-quality head-on max-velocity capture: sagittal angles untrustworthy. */
export const headOnMaxVClip: PrecomputedClip = {
  clipId: 'precomp-headon-maxv',
  fps: 60,
  cameraAzimuthDeg: 85,
  framing: 'partial',
  motionBlur: 'high',
  frames: buildFrames(24, 60, 4, 0.08, 0.55, 0.28), // leanZ small -> near-upright max-velocity
};

export const PRECOMPUTED_CLIPS: Record<string, PrecomputedClip> = {
  [sideAccelClip.clipId]: sideAccelClip,
  'side-acceleration': sideAccelClip,
  [headOnMaxVClip.clipId]: headOnMaxVClip,
  'headon-maxvelocity': headOnMaxVClip,
};

/** Pick a precomputed clip from a video URI (reduced-mode "loader"). */
export function loadPrecomputed(localVideoUri: string): PrecomputedClip {
  const uri = localVideoUri.toLowerCase();
  if (/(headon|head-on|lowq|low-q|maxv)/.test(uri)) return headOnMaxVClip;
  return sideAccelClip;
}
