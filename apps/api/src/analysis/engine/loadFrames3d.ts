// Load Stage 2–3 GPU output (.frames3d.json sidecar from ml-worker WHAM+OpenCap).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import type { Frame3D } from './types.js';

export interface Pipeline3DClip {
  frames: Frame3D[];
  fps: number;
  cameraAzimuthDeg: number;
  reconstructionMethod: '2d' | '3d-mono' | '3d-multi';
  meanKeypointConfidence: number;
  meanReconResidual: number;
  stage2Backend?: string;
  stage3Backend?: string;
}

const SUFFIX = '.frames3d.json';

function sidecarPaths(videoPath: string, explicitPath?: string): string[] {
  const base = videoPath.replace(/\.[^.]+$/, '');
  return [
    explicitPath,
    `${base}${SUFFIX}`,
    join(dirname(videoPath), `${basename(base)}${SUFFIX}`),
  ].filter(Boolean) as string[];
}

export function loadFrames3dSidecar(videoPath: string, explicitPath?: string): Pipeline3DClip | null {
  for (const p of sidecarPaths(videoPath, explicitPath)) {
    if (!existsSync(p)) continue;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<Pipeline3DClip>;
    if (!raw.frames?.length) continue;
    return {
      frames: raw.frames,
      fps: raw.fps ?? 60,
      cameraAzimuthDeg: raw.cameraAzimuthDeg ?? 30,
      reconstructionMethod: raw.reconstructionMethod ?? '3d-multi',
      meanKeypointConfidence: raw.meanKeypointConfidence ?? 0.7,
      meanReconResidual: raw.meanReconResidual ?? 0.1,
      stage2Backend: raw.stage2Backend,
      stage3Backend: raw.stage3Backend,
    };
  }
  return null;
}
