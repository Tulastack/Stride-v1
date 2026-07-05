/**
 * Compare two REAL reconstructed clips (produced by the ml-worker pipeline on
 * actual videos) through the production engine — to pressure-test the
 * angle-robustness claim on real footage.
 *
 * Run:  cd apps/api && npx tsx scripts/compare-real-clips.ts <sideFrames3d.json> <headonFrames3d.json>
 */
import { readFileSync } from 'node:fs';
import { assembleAnalysisFromFrames } from '../src/analysis/engine/engine.js';
import type { Frame3D } from '../src/analysis/engine/types.js';

interface Frames3dFile {
  fps: number;
  cameraAzimuthDeg: number;
  reconstructionMethod?: '2d' | '3d-mono' | '3d-multi';
  meanKeypointConfidence: number;
  meanReconResidual: number;
  motionBlur?: 'low' | 'med' | 'high';
  framing?: 'full' | 'partial';
  frames: Frame3D[];
}

function runClip(label: string, file: Frames3dFile) {
  const result = assembleAnalysisFromFrames({
    clipId: label,
    fps: file.fps,
    frames: file.frames,
    cameraAzimuthDeg: file.cameraAzimuthDeg,
    motionBlur: file.motionBlur ?? 'med',
    framing: file.framing ?? 'full',
    meanKeypointConfidence: file.meanKeypointConfidence,
    meanReconResidual: file.meanReconResidual,
    reconstructionMethod: file.reconstructionMethod ?? '3d-mono',
  });
  return result;
}

const [, , sidePath, headonPath] = process.argv;
if (!sidePath || !headonPath) {
  console.error('usage: compare-real-clips.ts <side.frames3d.json> <headon.frames3d.json>');
  process.exit(1);
}

const side: Frames3dFile = JSON.parse(readFileSync(sidePath, 'utf8'));
const headon: Frames3dFile = JSON.parse(readFileSync(headonPath, 'utf8'));

console.log('\n=== REAL-VIDEO angle robustness (production engine) ===');
console.log(`SIDE   clip: az=${side.cameraAzimuthDeg}°  frames=${side.frames.length}  recon=${side.reconstructionMethod}  meanConf=${side.meanKeypointConfidence}  meanRes=${side.meanReconResidual}`);
console.log(`HEADON clip: az=${headon.cameraAzimuthDeg}°  frames=${headon.frames.length}  recon=${headon.reconstructionMethod}  meanConf=${headon.meanKeypointConfidence}  meanRes=${headon.meanReconResidual}`);

const sideR = runClip('side', side);
const headR = runClip('headon', headon);

const byKey = (r: ReturnType<typeof runClip>) =>
  Object.fromEntries(r.metrics.map((m) => [m.key, m]));
const s = byKey(sideR);
const h = byKey(headR);

const keys = Array.from(new Set([...Object.keys(s), ...Object.keys(h)]));
const pad = (x: string, n: number) => x.padEnd(n);
const fmt = (m: any) =>
  m ? `${m.measured.value.toFixed(1)}${m.unit}  conf=${m.measured.confidence.toFixed(2)}  ${m.trustStatus}` : '—';

console.log('\n' + pad('metric', 18) + pad('SIDE (left_angle)', 34) + 'HEAD-ON (forward_angle)');
console.log('-'.repeat(84));
for (const k of keys) {
  console.log(pad(k, 18) + pad(fmt(s[k]), 34) + fmt(h[k]));
  if (s[k] && h[k]) {
    const dv = Math.abs(s[k].measured.value - h[k].measured.value);
    const dc = s[k].measured.confidence - h[k].measured.confidence;
    console.log(
      pad('', 18) +
        `   Δvalue=${dv.toFixed(2)}${s[k].unit}   Δconfidence(side-headon)=${dc >= 0 ? '+' : ''}${dc.toFixed(2)}` +
        (h[k].trustStatus === 'experimental' && s[k].trustStatus === 'trusted'
          ? '   <- head-on demoted to experimental (gate working)'
          : ''),
    );
  }
}

console.log('\n=== What to read here ===');
console.log('• Small Δvalue on trusted metrics = the reconstruction+canonicalization agree across angles.');
console.log('• Large Δvalue on sagittal angle metrics + head-on flipping to "experimental" = the honest');
console.log('  failure mode: the pipeline knows the head-on view can\'t support those angles and says so.');
console.log('• Overall scores:', `side=${Math.round(sideR.captureQuality.overall * 100)}`, `head-on=${Math.round(headR.captureQuality.overall * 100)}\n`);
