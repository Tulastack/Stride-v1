// Load Stage 0 capture manifest (gyro sidecar + intrinsics).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import type { CaptureManifest, GyroSample } from './types.js';

function sidecarPaths(videoPath: string, gyroPath?: string): string[] {
  const base = videoPath.replace(/\.[^.]+$/, '');
  const out = [
    gyroPath,
    `${base}.capture.json`,
    `${base}.gyro.json`,
    join(dirname(videoPath), `${basename(base)}.capture.json`),
  ].filter(Boolean) as string[];
  return out;
}

export function loadCaptureManifest(videoPath: string, gyroPath?: string): CaptureManifest {
  for (const p of sidecarPaths(videoPath, gyroPath)) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<CaptureManifest> & { gyro?: GyroSample[] };
      return {
        videoPath,
        fps: raw.fps ?? 60,
        preferredFps: raw.preferredFps ?? raw.fps ?? 120,
        widthPx: raw.widthPx ?? 1080,
        heightPx: raw.heightPx ?? 1920,
        durationMs: raw.durationMs ?? 3000,
        motionBlur: raw.motionBlur ?? 'med',
        framing: raw.framing ?? 'full',
        handheld: raw.handheld ?? true,
        gyro: raw.gyro ?? [],
        intrinsics: raw.intrinsics,
        cameraAzimuthDeg: raw.cameraAzimuthDeg,
      };
    }
  }

  // Minimal manifest when no sidecar — pipeline still requires keypoints/frames3d sidecars.
  return {
    videoPath,
    fps: 60,
    preferredFps: 120,
    widthPx: 1080,
    heightPx: 1920,
    durationMs: 3000,
    motionBlur: 'med',
    framing: 'full',
    handheld: true,
    gyro: [],
  };
}
