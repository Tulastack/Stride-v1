/**
 * End-to-end pipeline test using golden fixture sidecars (MoveNet → WHAM+OpenCap output).
 * No runtime synthetic data — fixtures are checked-in pipeline artifacts.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { ReducedBiomechanicsEngine, assembleAnalysisFromFrames } from '../analysis/engine/engine.js';
import { validateAnalysisResult } from '../analysis/validate.js';
import type { Flaw } from '@stride/types';
import type { Frame3D } from '../analysis/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VIDEO = join(here, '../analysis/engine/__tests__/fixtures/stride-side.mp4');
const FIXTURE_FRAMES3D = join(here, '../analysis/engine/__tests__/fixtures/stride-side.frames3d.json');

interface FixtureClip {
  fps: number;
  cameraAzimuthDeg: number;
  reconstructionMethod: '3d-mono' | '3d-multi';
  meanKeypointConfidence: number;
  meanReconResidual: number;
  frames: Frame3D[];
}

describe('Biomechanics pipeline E2E (golden fixtures)', () => {
  it('analyze() loads .frames3d.json sidecar and validates contract', () => {
    const engine = new ReducedBiomechanicsEngine();
    const result = engine.analyze(FIXTURE_VIDEO);
    expect(() => validateAnalysisResult(result)).not.toThrow();
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.reconstructionMethod).toMatch(/^3d-/);
  });

  it('assembleAnalysisFromFrames matches worker → API biomech callback path', () => {
    const clip = JSON.parse(readFileSync(FIXTURE_FRAMES3D, 'utf8')) as FixtureClip;
    const result = assembleAnalysisFromFrames({
      clipId: 'e2e-test',
      fps: clip.fps,
      frames: clip.frames,
      cameraAzimuthDeg: clip.cameraAzimuthDeg,
      motionBlur: 'low',
      framing: 'full',
      meanKeypointConfidence: clip.meanKeypointConfidence,
      meanReconResidual: clip.meanReconResidual,
      reconstructionMethod: clip.reconstructionMethod,
    });
    expect(() => validateAnalysisResult(result)).not.toThrow();
    expect(result.flaws.every((f: Flaw) => f.evidence.measured.confidence >= 0)).toBe(true);
  });
});
