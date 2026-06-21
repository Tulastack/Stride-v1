// Stage 1 — detect/load 2D keypoints from real video input.
//
// Priority:
//   1. Companion `.keypoints.json` (MoveNet export from ml-worker)
//   2. Spawn MoveNet Python export when STRIDE_MOVENET_PYTHON=1 and video exists
// No synthetic fallback — missing keypoints is a hard error.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PipelineInputError } from '../errors.js';
import type { CaptureManifest } from './capture/types.js';
import type { JointName, Keypoint2D, Keypoints2DFrame } from './types.js';

export interface RawKeypointClip {
  fps: number;
  frames: Keypoints2DFrame[];
}

interface KeypointsJson {
  fps: number;
  frames: Array<{ tMs: number; joints: Partial<Record<JointName, Keypoint2D>> }>;
}

const KEYPOINTS_SUFFIX = '.keypoints.json';

function keypointsPathFor(videoPath: string): string {
  return videoPath.replace(/\.[^.]+$/, '') + KEYPOINTS_SUFFIX;
}

function parseKeypointsJson(raw: KeypointsJson): RawKeypointClip {
  return {
    fps: raw.fps,
    frames: raw.frames.map((f) => f.joints),
  };
}

function tryLoadKeypointsFile(path: string): RawKeypointClip | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as KeypointsJson;
  return parseKeypointsJson(raw);
}

function tryMovenetExport(videoPath: string): RawKeypointClip | null {
  if (process.env.STRIDE_MOVENET_PYTHON !== '1') return null;
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, '../../../../../apps/ml-worker/scripts/export_keypoints.py');
  if (!existsSync(script)) return null;
  try {
    const out = execFileSync('python3', [script, videoPath], { encoding: 'utf8', timeout: 120_000 });
    const raw = JSON.parse(out) as KeypointsJson;
    return parseKeypointsJson(raw);
  } catch {
    return null;
  }
}

/** Load 2D keypoints for a video + capture manifest. Throws if none found. */
export function detectKeypoints(manifest: CaptureManifest): RawKeypointClip {
  const sidecar = keypointsPathFor(manifest.videoPath);
  const fromFile = tryLoadKeypointsFile(sidecar);
  if (fromFile) return fromFile;

  const fromPython = tryMovenetExport(manifest.videoPath);
  if (fromPython) return fromPython;

  throw new PipelineInputError(
    `No keypoints for "${manifest.videoPath}". Provide ${sidecar} or enable STRIDE_MOVENET_PYTHON=1 with MoveNet.`
  );
}
