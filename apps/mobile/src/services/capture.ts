// Mobile capture pipeline — gyro recording, intrinsics estimate, capture manifest.
// Stage 0 sidecar consumed by the biomechanics engine (PRD v2.2-B addendum).

import { Dimensions, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Gyroscope } from 'expo-sensors';

export interface GyroSample {
  tMs: number;
  yawRateRadS: number;
  pitchRateRadS: number;
  rollRateRadS: number;
}

export interface CameraIntrinsics {
  focalLengthPx: number;
  principalPointPx: [number, number];
  sensorWidthPx: number;
  sensorHeightPx: number;
}

export interface CaptureManifest {
  fps: number;
  preferredFps: number;
  widthPx: number;
  heightPx: number;
  durationMs: number;
  motionBlur: 'low' | 'med' | 'high';
  framing: 'full' | 'partial';
  handheld: boolean;
  gyro: GyroSample[];
  intrinsics: CameraIntrinsics;
  sloMoRequested: boolean;
  /** User-selected target runner to analyze (normalized 0..1), for multi-person clips. */
  target?: { xNorm: number; yNorm: number; tMs: number };
}

const { width: screenW, height: screenH } = Dimensions.get('window');

/** Typical phone vertical FOV (~60°) → focal length in px. */
export function estimateIntrinsics(widthPx = screenW, heightPx = screenH): CameraIntrinsics {
  const focal = heightPx / (2 * Math.tan((30 * Math.PI) / 180));
  return {
    focalLengthPx: Math.round(focal),
    principalPointPx: [Math.round(widthPx / 2), Math.round(heightPx / 2)],
    sensorWidthPx: Math.round(widthPx),
    sensorHeightPx: Math.round(heightPx),
  };
}

export class GyroRecorder {
  private samples: GyroSample[] = [];
  private startedAt = 0;
  private sub: { remove: () => void } | null = null;

  async start(): Promise<void> {
    this.samples = [];
    this.startedAt = Date.now();
    const available = await Gyroscope.isAvailableAsync();
    if (!available) return;
    Gyroscope.setUpdateInterval(50);
    this.sub = Gyroscope.addListener(({ x, y, z }) => {
      this.samples.push({
        tMs: Date.now() - this.startedAt,
        yawRateRadS: z,
        pitchRateRadS: x,
        rollRateRadS: y,
      });
    });
  }

  stop(): GyroSample[] {
    this.sub?.remove();
    this.sub = null;
    return this.samples;
  }
}

export function buildCaptureManifest(opts: {
  videoUri: string;
  gyro: GyroSample[];
  durationMs?: number;
  fps?: number;
  preferredFps?: number;
  widthPx?: number;
  heightPx?: number;
  sloMoRequested?: boolean;
}): CaptureManifest {
  const widthPx = opts.widthPx ?? Math.round(screenW);
  const heightPx = opts.heightPx ?? Math.round(screenH);
  const fps = opts.fps ?? 60;
  const preferredFps = opts.preferredFps ?? 120;
  const motionBlur: CaptureManifest['motionBlur'] =
    fps >= 120 ? 'low' : fps >= 90 ? 'med' : 'high';

  return {
    fps,
    preferredFps,
    widthPx,
    heightPx,
    durationMs: opts.durationMs ?? 4000,
    motionBlur,
    framing: 'full',
    handheld: true,
    gyro: opts.gyro,
    intrinsics: estimateIntrinsics(widthPx, heightPx),
    sloMoRequested: opts.sloMoRequested ?? preferredFps >= 120,
  };
}

/** Persist capture sidecar next to the video URI (dev) or cache dir. */
export async function writeCaptureSidecar(videoUri: string, manifest: CaptureManifest): Promise<string> {
  const base = videoUri.replace(/\.[^.]+$/, '');
  const path = `${base}.capture.json`;
  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(manifest));
    return path;
  } catch {
    const cachePath = `${FileSystem.cacheDirectory}capture-${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(cachePath, JSON.stringify(manifest));
    return cachePath;
  }
}

/** Upload a local video blob via presigned multipart + capture manifest. */
export async function uploadCaptureVideo(
  videoUri: string,
  manifest: CaptureManifest,
  api: {
    requestUploadUrls: (n: number) => Promise<{ analysisId: string; uploadId: string; parts: { partNumber: number; url: string }[] }>;
    finalizeUpload: (
      analysisId: string,
      uploadId: string,
      parts: { partNumber: number; etag: string }[],
      captureManifest?: CaptureManifest
    ) => Promise<{ analysisId: string }>;
  }
): Promise<{ analysisId: string }> {
  const blob = await fetch(videoUri).then((r) => r.blob());
  const { analysisId, uploadId, parts } = await api.requestUploadUrls(1);
  const part = parts[0];
  const put = await fetch(part.url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'video/mp4' } });
  if (!put.ok) throw new Error(`Video upload failed (${put.status})`);
  const etag = put.headers.get('ETag')?.replace(/"/g, '') ?? `"part-${part.partNumber}"`;
  await api.finalizeUpload(analysisId, uploadId, [{ partNumber: part.partNumber, etag }], manifest);
  return { analysisId };
}

export const CAPTURE_PREFS = {
  preferredFps: 120,
  sloMoLabel: Platform.OS === 'ios' ? '120fps slo-mo when available' : 'High-speed capture when available',
};
