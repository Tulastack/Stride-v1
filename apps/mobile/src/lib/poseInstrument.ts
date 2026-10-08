import type { OverlayFrame } from './overlaySync';

export type Joint = 'knee' | 'hip' | 'elbow';
const JOINTS: Record<Joint, [number, number, number]> = { knee: [11, 13, 15], hip: [5, 11, 13], elbow: [5, 7, 9] };

export function jointIndices(joint: Joint, right = false): [number, number, number] {
  return JOINTS[joint].map((index) => index + (right ? 1 : 0)) as [number, number, number];
}

export function measuredJointAngle(frame: OverlayFrame, joint: Joint, right = false, width = 1, height = 1): number | null {
  const points = jointIndices(joint, right).map((index) => frame.kp[index]);
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (points.some((point) => !point || point.length < 3 || point[2] < 0.5 || !point.every(Number.isFinite))) return null;
  const [first, center, last] = points;
  const firstVector = [(first[0] - center[0]) * height, (first[1] - center[1]) * width];
  const lastVector = [(last[0] - center[0]) * height, (last[1] - center[1]) * width];
  const length = Math.hypot(...firstVector) * Math.hypot(...lastVector);
  if (length < 1e-9) return null;
  const cosine = (firstVector[0] * lastVector[0] + firstVector[1] * lastVector[1]) / length;
  return Math.round(Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI);
}

export function preferredSide(frames: OverlayFrame[], joint: Joint): boolean {
  const confidence = (right: boolean) => frames.reduce((total, frame) => total + jointIndices(joint, right).reduce((sum, index) => sum + (frame.kp[index]?.[2] ?? 0), 0), 0);
  return confidence(true) > confidence(false);
}
