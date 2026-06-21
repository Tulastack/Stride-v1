// Stage 0 capture metadata — video + gyro + intrinsics from the phone.
import type { CameraIntrinsics } from '@stride/types';

export interface GyroSample {
  timestampMs: number;
  /** Angular velocity rad/s in device frame (x, y, z). */
  wx: number;
  wy: number;
  wz: number;
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
  intrinsics?: CameraIntrinsics;
  /** Estimated from metadata / keypoint geometry when not from user. */
  cameraAzimuthDeg?: number;
}
