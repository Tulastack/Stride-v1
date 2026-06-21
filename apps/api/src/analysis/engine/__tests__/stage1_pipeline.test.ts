/**
 * Stage 1 live pipeline — detect → hygiene → azimuth on golden fixture keypoints.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectKeypoints } from '../stage1_detect.js';
import { runStage1Hygiene, estimateCameraAzimuth } from '../stage1_pipeline.js';
import { loadCaptureManifest } from '../capture/loadManifest.js';

const FIXTURE_BASE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/stride-side.mp4'
);

describe('Stage 1 pipeline (golden keypoints fixture)', () => {
  it('orchestrates detect → hygiene on checked-in keypoints', () => {
    const manifest = loadCaptureManifest(FIXTURE_BASE);
    const raw = detectKeypoints(manifest);
    expect(raw.frames.length).toBeGreaterThan(0);

    const stage1 = runStage1Hygiene(raw.frames, raw.fps);
    expect(stage1.frames.length).toBe(raw.frames.length);
    expect(stage1.meanKeypointConfidence).toBeGreaterThan(0.5);

    const azimuth = estimateCameraAzimuth(stage1.frames);
    expect(azimuth).toBeGreaterThan(0);
  });

  it('throws when keypoints sidecar is missing', () => {
    const manifest = loadCaptureManifest('/tmp/nonexistent-clip.mp4');
    expect(() => detectKeypoints(manifest)).toThrow(/No keypoints/i);
  });
});
