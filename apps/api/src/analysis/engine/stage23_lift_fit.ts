// Stage 2 (WHAM-class monocular 3D lift) + Stage 3 (OpenCap-Monocular skeleton fit).
//
// Production path: ml-worker runs WHAM → OpenCap and writes `.frames3d.json`.
// Local/dev path: spawn Python pipeline3d or load an existing sidecar.

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Keypoints2DFrame, Frame3D } from './types.js';
import type { CaptureManifest } from './capture/types.js';
import { loadFrames3dSidecar, type Pipeline3DClip } from './loadFrames3d.js';
import { PipelineInputError } from '../errors.js';

export interface LiftInputs {
  videoPath: string;
  keypoints: Keypoints2DFrame[];
  fps: number;
  manifest: CaptureManifest;
  sidecarPath?: string;
}

export interface LiftFitResult {
  frames: Frame3D[];
  cameraAzimuthDeg: number;
  meanReconResidual: number;
  reconstructionMethod: '3d-mono' | '3d-multi';
  backend: string;
}

/** Load WHAM+OpenCap output from disk sidecar (preferred). */
export function loadWhamOpenCapSidecar(videoPath: string, sidecarPath?: string): LiftFitResult | null {
  const clip = loadFrames3dSidecar(videoPath, sidecarPath);
  if (!clip) return null;
  return {
    frames: clip.frames,
    cameraAzimuthDeg: clip.cameraAzimuthDeg,
    meanReconResidual: clip.meanReconResidual,
    reconstructionMethod: clip.reconstructionMethod === '3d-multi' ? '3d-multi' : '3d-mono',
    backend: `${clip.stage2Backend ?? 'wham'}+${clip.stage3Backend ?? 'opencap'}`,
  };
}

/** Spawn ml-worker pipeline3d CLI (STRIDE_PIPELINE3D=1). */
function tryPythonPipeline(inputs: LiftInputs): LiftFitResult | null {
  if (process.env.STRIDE_PIPELINE3D !== '1') return null;
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, '../../../../../apps/ml-worker/scripts/run_pipeline3d.py');
  if (!existsSync(script)) return null;
  try {
    const out = execFileSync(
      'python3',
      [script, inputs.videoPath, inputs.manifest.videoPath + '.capture.json'],
      { encoding: 'utf8', timeout: 600_000 }
    );
    const clip = JSON.parse(out) as Pipeline3DClip;
    return {
      frames: clip.frames,
      cameraAzimuthDeg: clip.cameraAzimuthDeg,
      meanReconResidual: clip.meanReconResidual,
      reconstructionMethod: clip.reconstructionMethod === '3d-multi' ? '3d-multi' : '3d-mono',
      backend: `${clip.stage2Backend ?? 'python'}+${clip.stage3Backend ?? 'opencap'}`,
    };
  } catch {
    return null;
  }
}

/**
 * Stage 2–3 full fidelity: WHAM monocular HMR → OpenCap-Monocular skeleton fit.
 * Falls back to inline monocular lift only when no GPU sidecar is present.
 */
export function liftAndFit(inputs: LiftInputs): LiftFitResult {
  const fromSidecar = loadWhamOpenCapSidecar(inputs.videoPath, inputs.sidecarPath);
  if (fromSidecar) return fromSidecar;

  const fromPython = tryPythonPipeline(inputs);
  if (fromPython) return fromPython;

  throw new PipelineInputError(
    `Stage 2–3 requires a .frames3d.json sidecar from the ml-worker WHAM+OpenCap pipeline for "${inputs.videoPath}".`
  );
}
