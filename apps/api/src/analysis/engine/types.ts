// Internal engine types. Joint names are a sprint-relevant subset.

import type { Vec3 } from './math.js';

export type JointName =
  | 'head'
  | 'neck'
  | 'l_shoulder'
  | 'r_shoulder'
  | 'l_hip'
  | 'r_hip'
  | 'l_knee'
  | 'r_knee'
  | 'l_ankle'
  | 'r_ankle'
  | 'l_toe'
  | 'r_toe';

/** A 2D keypoint with detector confidence (Stage 1 output, per joint). */
export interface Keypoint2D {
  x: number;
  y: number;
  confidence: number; // 0..1
}

export type Keypoints2DFrame = Partial<Record<JointName, Keypoint2D>>;

/** A 3D pose in the world (gravity-aligned) frame (Stage 2–3 output). */
export type Pose3D = Record<JointName, Vec3>;

/** A pose expressed in the canonical (pelvis-centric, gravity-aligned) frame. */
export type CanonicalPose = Record<JointName, Vec3>;

export interface Frame3D {
  timestampMs: number;
  pose: Pose3D;
  /** Mean detector confidence of the keypoints behind this frame (0..1). */
  keypointConfidence: number;
  /** Stage 2–3 reconstruction residual (lower is better). */
  reconResidual: number;
}

/** A precomputed clip used by the reduced dev mode (stands in for SMPL output). */
export interface PrecomputedClip {
  clipId: string;
  fps: number;
  frames: Frame3D[];
  /** True azimuth of the camera relative to the run direction, degrees.
   *  0 = side-on (ideal), 90 = head-on (degenerate for sagittal angles). */
  cameraAzimuthDeg: number;
  framing: 'full' | 'partial';
  motionBlur: 'low' | 'med' | 'high';
}
