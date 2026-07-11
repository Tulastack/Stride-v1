// Stage 0 capture metadata — video + gyro + intrinsics from the phone.
import type { CameraIntrinsics } from '@stride/types';

export interface GyroSample {
  timestampMs: number;
  /** Angular velocity rad/s in device frame (x, y, z). */
  wx: number;
  wy: number;
  wz: number;
}

export interface AccelSample {
  timestampMs: number;
  /** Linear acceleration incl. gravity, m/s^2, device frame (x, y, z). */
  ax: number;
  ay: number;
  az: number;
}

export interface CaptureManifest {
  videoPath: string;
  fps: number;
  /** Actual or preferred capture frame rate (120+ for sprinting). */
  preferredFps: number;
  widthPx: number;
  heightPx: number;
  durationMs: number;
  motionBlur: 'low' | 'med' | 'high';
  framing: 'full' | 'partial';
  /** Handheld is expected — gyro enables camera-motion decoupling. */
  handheld: boolean;
  gyro: GyroSample[];
  /** Optional accelerometer stream; fused with gyro to recover gravity. */
  accelerometer?: AccelSample[];
  /**
   * Measured world-up (unit) in the SAME frame as the reconstructed 3D pose.
   * When present, Stage 4 canonicalizes against this instead of the hardcoded
   * [0,1,0] — making angles invariant to camera pitch/roll/elevation, not just
   * yaw. Produced by fusing accelerometer + gyro (see engine/gravity.ts) and
   * mapping into the pose frame (a calibrated capture-layer step).
   */
  gravityWorld?: readonly [number, number, number];
  intrinsics?: CameraIntrinsics;
  /** Estimated from metadata / keypoint geometry when not from user. */
  cameraAzimuthDeg?: number;
}
