// Load Stage 0 capture manifest (gyro sidecar + intrinsics).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import type { AccelSample, CaptureManifest, GyroSample } from './types.js';

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

/** Normalize mobile `{tMs, yawRate…}` or API `{timestampMs, wx…}` gyro samples. */
function normalizeGyro(raw: unknown): GyroSample[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g: any) => ({
    timestampMs: Number(g.timestampMs ?? g.tMs ?? 0),
    wx: Number(g.wx ?? g.pitchRateRadS ?? 0),
    wy: Number(g.wy ?? g.rollRateRadS ?? 0),
    wz: Number(g.wz ?? g.yawRateRadS ?? 0),
  }));
}

function normalizeAccel(raw: unknown): AccelSample[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((a: any) => ({
    timestampMs: Number(a.timestampMs ?? a.tMs ?? 0),
    ax: Number(a.ax ?? a.x ?? 0),
    ay: Number(a.ay ?? a.y ?? 0),
    az: Number(a.az ?? a.z ?? 0),
  }));
}

export function loadCaptureManifest(videoPath: string, gyroPath?: string): CaptureManifest {
  for (const p of sidecarPaths(videoPath, gyroPath)) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<CaptureManifest> & {
        gyro?: unknown;
        accelerometer?: unknown;
        imageGravity2D?: [number, number];
      };
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
        gyro: normalizeGyro(raw.gyro),
        accelerometer: normalizeAccel(raw.accelerometer),
        gravityWorld: raw.gravityWorld,
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
