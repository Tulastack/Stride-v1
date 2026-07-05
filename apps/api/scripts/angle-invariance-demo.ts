/**
 * Angle-invariance demonstration.
 *
 * Loads a REAL reconstructed-3D clip (the engine test fixture), then rotates the
 * entire skeleton about the gravity (vertical) axis through a sweep of camera
 * azimuths — 0° (side-on) up to 90° (head-on). For each simulated viewpoint it
 * runs the ACTUAL production engine (Stages 4–7: canonicalize → metrics →
 * confidence) and prints the resulting metric values, confidence bands, and
 * trust status.
 *
 * What it proves:
 *   • Canonical metric VALUES are invariant to camera azimuth (Stage 4 works).
 *   • Confidence DEGRADES honestly as the view goes head-on (Stage 6 works),
 *     and sagittal metrics get flagged 'experimental' at bad angles.
 *
 * Run:  cd apps/api && npx tsx scripts/angle-invariance-demo.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assembleAnalysisFromFrames } from '../src/analysis/engine/engine.js';
import type { Frame3D, JointName } from '../src/analysis/engine/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  '../src/analysis/engine/__tests__/fixtures/stride-side.frames3d.json',
);

interface Frames3dFile {
  fps: number;
  meanKeypointConfidence: number;
  meanReconResidual: number;
  frames: Frame3D[];
}

const fixture: Frames3dFile = JSON.parse(readFileSync(fixturePath, 'utf8'));

/** Rotate a 3D point about the vertical (gravity, +Y) axis by θ radians. */
function rotateY([x, y, z]: [number, number, number], theta: number): [number, number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [x * c + z * s, y, -x * s + z * c];
}

/** Re-express an entire clip as if the camera sat at `azimuthDeg` around the runner. */
function rotateClip(frames: Frame3D[], azimuthDeg: number): Frame3D[] {
  const theta = (azimuthDeg * Math.PI) / 180;
  return frames.map((f) => {
    const pose = {} as Frame3D['pose'];
    for (const joint of Object.keys(f.pose) as JointName[]) {
      pose[joint] = rotateY(f.pose[joint] as [number, number, number], theta);
    }
    return { ...f, pose };
  });
}

const AZIMUTHS = [0, 15, 30, 45, 60, 75, 90];
const TRACK = ['knee_drive', 'hip_extension', 'trunk_lean', 'cadence_spm', 'contact_time_ms'];

console.log('\n=== Stride angle-invariance demo (real engine, real 3D fixture) ===');
console.log(`Fixture: ${fixture.frames.length} frames @ ${fixture.fps}fps\n`);

// Collect per-azimuth results.
type Row = { az: number; values: Record<string, number>; conf: Record<string, number>; trust: Record<string, string>; band: Record<string, number> };
const rows: Row[] = [];

for (const az of AZIMUTHS) {
  const rotated = rotateClip(fixture.frames, az);
  const result = assembleAnalysisFromFrames({
    clipId: `az-${az}`,
    fps: fixture.fps,
    frames: rotated,
    cameraAzimuthDeg: az,
    motionBlur: 'low',
    framing: 'full',
    meanKeypointConfidence: fixture.meanKeypointConfidence,
    meanReconResidual: fixture.meanReconResidual,
    reconstructionMethod: '3d-mono',
  });

  const row: Row = { az, values: {}, conf: {}, trust: {}, band: {} };
  for (const m of result.metrics) {
    if (!TRACK.includes(m.key)) continue;
    row.values[m.key] = m.measured.value;
    row.conf[m.key] = m.measured.confidence;
    row.trust[m.key] = m.trustStatus;
    row.band[m.key] = Math.round((m.measured.high - m.measured.low) * 100) / 100;
  }
  rows.push(row);
}

const pad = (s: string, n: number) => s.padEnd(n);
const num = (x: number | undefined, d = 1) => (x === undefined ? '—' : x.toFixed(d));

for (const key of TRACK) {
  console.log(`\n── ${key} ──`);
  console.log(pad('azimuth', 10) + pad('value', 10) + pad('confidence', 13) + pad('band±width', 13) + 'trust');
  for (const r of rows) {
    console.log(
      pad(`${r.az}°`, 10) +
        pad(num(r.values[key]), 10) +
        pad(num(r.conf[key], 3), 13) +
        pad(num(r.band[key], 2), 13) +
        (r.trust[key] ?? '—'),
    );
  }
  // Invariance check across azimuth for the VALUE.
  const vals = rows.map((r) => r.values[key]).filter((v): v is number => v !== undefined);
  if (vals.length > 1) {
    const spread = Math.max(...vals) - Math.min(...vals);
    const verdict = spread < 0.5 ? '✅ INVARIANT' : spread < 2 ? '≈ near-invariant' : '⚠️ varies';
    console.log(`   value spread across 0°→90°: ${spread.toFixed(3)}  ${verdict}`);
  }
}

console.log('\n=== Interpretation ===');
console.log('• If "value" is flat across azimuth → Stage 4 canonicalization is view-invariant.');
console.log('• If "confidence" falls and band widens toward 90° → Stage 6 honestly down-weights');
console.log('  head-on views instead of emitting a confident wrong number.');
console.log('• Sagittal metrics flipping to "experimental" at bad angles is the trust gate working.\n');
