// Mobile capture pipeline, gyro + accelerometer recording, intrinsics, capture manifest.
// Stage 0 sidecar consumed by the biomechanics engine (PRD v2.2-B addendum).

import { Dimensions } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Accelerometer, Gyroscope } from 'expo-sensors';

export interface GyroSample {
  tMs: number;
  yawRateRadS: number;
  pitchRateRadS: number;
  rollRateRadS: number;
}

export interface AccelSample {
  tMs: number;
  /** Linear acceleration incl. gravity, m/s^2 (Expo reports in g; we store ×9.80665). */
  ax: number;
  ay: number;
  az: number;
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
  accelerometer?: AccelSample[];
  /** Optional image-plane gravity [dy, dx] in keypoint [y,x] coords. */
  imageGravity2D?: [number, number];
  intrinsics: CameraIntrinsics;
  sloMoRequested: boolean;
  /** User-selected target runner (normalized 0..1) for multi-person clips,
   * a brush-traced bbox {x0,y0,x1,y1} (preferred) or a point {xNorm,yNorm}. */
  target?: {
    xNorm?: number; yNorm?: number;
    x0?: number; y0?: number; x1?: number; y1?: number;
    tMs: number;
  };
}

const { width: screenW, height: screenH } = Dimensions.get('window');
const G = 9.80665;

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

/** Accelerometer for gravity fusion (research Phase 0/1). Expo units are g. */
export class AccelRecorder {
  private samples: AccelSample[] = [];
  private startedAt = 0;
  private sub: { remove: () => void } | null = null;

  async start(): Promise<void> {
    this.samples = [];
    this.startedAt = Date.now();
    const available = await Accelerometer.isAvailableAsync();
    if (!available) return;
    Accelerometer.setUpdateInterval(50);
    this.sub = Accelerometer.addListener(({ x, y, z }) => {
      this.samples.push({
        tMs: Date.now() - this.startedAt,
        ax: x * G,
        ay: y * G,
        az: z * G,
      });
    });
  }

  stop(): AccelSample[] {
    this.sub?.remove();
    this.sub = null;
    return this.samples;
  }
}

/** Rough portrait image-plane gravity from mean accel (device y-up → image y-down). */
export function imageGravityFromAccel(accel: AccelSample[]): [number, number] | undefined {
  if (!accel.length) return undefined;
  const mx = accel.reduce((s, a) => s + a.ax, 0) / accel.length;
  const my = accel.reduce((s, a) => s + a.ay, 0) / accel.length;
  const mag = Math.hypot(mx, my);
  if (mag < 1e-6) return undefined;
  return [-my / mag, mx / mag];
}

export function buildCaptureManifest(opts: {
  videoUri: string;
  gyro: GyroSample[];
  accelerometer?: AccelSample[];
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
  const accelerometer = opts.accelerometer ?? [];
  const imageGravity2D = imageGravityFromAccel(accelerometer);

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
    ...(accelerometer.length ? { accelerometer } : {}),
    ...(imageGravity2D ? { imageGravity2D } : {}),
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

/** Upload a local video via the API blob PUT (or S3 part URL).
 *
 * Two iOS/RN footguns this avoids:
 * 1) `fetch(file://…).blob()` → "Network request failed"
 * 2) Server-built blob URLs that don't match the phone's working `apiBaseUrl`
 */
/** What the API and the S3 presign both expect the video to be sent as. */
const UPLOAD_CONTENT_TYPE = 'video/mp4';
/** A video is large; give it room, but never unbounded. */
const UPLOAD_TIMEOUT_MS = 180_000;

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
  },
  opts?: { apiBaseUrl?: string; token?: string | null },
): Promise<{ analysisId: string }> {
  const { analysisId, uploadId, parts } = await api.requestUploadUrls(1);
  const part = parts[0];
  if (!part?.url) throw new Error('Upload URL missing from server response');

  // Local-storage mode echoes an API blob URL whose host can be stale, rewrite
  // it to the host the app already talks to. Real presigned URLs (e.g. S3) are
  // used exactly as signed.
  const uploadUrl = rewriteUploadUrl(part.url, analysisId, opts?.apiBaseUrl, opts?.token);

  const raw = await readLocalFileAsBlob(videoUri);
  // The blob's OWN type has to be video/mp4, not just the header. Expo SDK 57
  // replaced the global fetch with a native one that rewrites Content-Type from
  // `blob.type` (expo/src/winter/fetch/RequestUtils.ts, normalizeBodyInitAsync),
  // so a .MOV read off the camera roll arrives as video/quicktime and silently
  // overrides the header below. For an S3 presigned PUT that breaks the
  // signature, because the server signed video/mp4.
  const fileBlob =
    raw.type === UPLOAD_CONTENT_TYPE ? raw : new Blob([raw], { type: UPLOAD_CONTENT_TYPE });

  let put: Response;
  try {
    put = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBlob,
      // For S3 presigned PUTs this header must match what was signed, the
      // server signs 'video/mp4', which is also what the API blob PUT expects.
      headers: { 'Content-Type': UPLOAD_CONTENT_TYPE },
      // A video is megabytes over a LAN, so this needs far longer than a JSON
      // call, but it still needs a limit: Expo's fetch otherwise sits on an
      // unreachable host until the platform gives up, and the athlete is left
      // watching a spinner with nothing to act on.
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err: any) {
    const host = (() => { try { return new URL(uploadUrl).host; } catch { return uploadUrl.slice(0, 40); } })();
    const timedOut =
      err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timed out/i.test(String(err?.message));
    throw new Error(
      timedOut
        ? `Upload to ${host} timed out. Check the API is running and the phone is on the same Wi-Fi.`
        : `Video upload network failed (${host}): ${err?.message ?? err}`,
    );
  }
  if (!put.ok) {
    const body = await put.text().catch(() => '');
    throw new Error(`Video upload failed (${put.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const etag = put.headers.get('ETag')?.replace(/"/g, '') ?? `"part-${part.partNumber}"`;
  await api.finalizeUpload(analysisId, uploadId, [{ partNumber: part.partNumber, etag }], manifest);
  return { analysisId };
}

/** Rewrite ONLY the API's local-storage blob URL (…/videos/:id/blob) to the
 * app's known API base + fresh token, that URL's host can be a stale LAN IP.
 * Anything else (e.g. an amazonaws.com presigned URL) is returned unchanged:
 * rewriting it would 404 and break the signature. */
function rewriteUploadUrl(
  serverUrl: string,
  analysisId: string,
  apiBaseUrl?: string,
  token?: string | null,
): string {
  if (!apiBaseUrl) return serverUrl;
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return serverUrl;
  }
  const isApiBlobUrl = parsed.pathname.includes('/videos/') && parsed.pathname.endsWith('/blob');
  if (!isApiBlobUrl) return serverUrl;
  const tok = token || parsed.searchParams.get('token') || '';
  return `${apiBaseUrl.replace(/\/$/, '')}/videos/${analysisId}/blob?token=${encodeURIComponent(tok)}`;
}

/** Read a local video URI into a Blob without `fetch(file://).blob()` (broken on iOS). */
function readLocalFileAsBlob(videoUri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', videoUri, true);
    xhr.responseType = 'blob';
    xhr.onload = () => {
      if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
        resolve(xhr.response as Blob);
      } else {
        reject(new Error(`Could not read video file (status ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Could not read local video file'));
    xhr.send(null);
  });
}

export const CAPTURE_PREFS = {
  preferredFps: 120,
  // Honest copy: CameraView records at the platform default (~30fps) today.
  sloMoLabel: 'High frame rate when available',
};
