// Labeled validation set (PROMPT B.2).
//
// Structured to later ingest real marker-based / high-fps reference data. For now
// it is synthetic but HONEST: predicted = truth + an error that grows as the view
// goes head-on for sagittal angles, and is worst for pelvis/hip at top speed —
// the documented hard case. Temporal metrics are nearly view-insensitive.

import type { ValidationSample, Phase, Viewpoint, MetricKey } from './harness.js';

const TRUTH: Record<Phase, Record<MetricKey, number>> = {
  acceleration: { trunk_lean: 44, knee_drive: 72, hip_extension: 45, contact_time_ms: 105, cadence_spm: 168 },
  max_velocity: { trunk_lean: 4, knee_drive: 78, hip_extension: 52, contact_time_ms: 92, cadence_spm: 184 },
};

// Systematic error (|bias|) by viewpoint for sagittal-plane angles.
const SAGITTAL_BIAS: Record<Viewpoint, number> = { side: 1.4, oblique: 3.2, 'head-on': 8.5 };
const SAGITTAL_KEYS: MetricKey[] = ['trunk_lean', 'knee_drive', 'hip_extension'];

// Deterministic jitter so RMSE/ICC are meaningful but reproducible.
function lcg(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2; // [-1,1)
}

function biasFor(metric: MetricKey, phase: Phase, viewpoint: Viewpoint): number {
  if (SAGITTAL_KEYS.includes(metric)) {
    let b = SAGITTAL_BIAS[viewpoint];
    // Hip at top speed is the worst case — inflate it.
    if (metric === 'hip_extension' && phase === 'max_velocity') b *= 1.4;
    return b;
  }
  return metric === 'contact_time_ms' ? 5.5 : 2.8; // temporal, view-insensitive
}

/** Build the labeled set: 6 samples per (phase × viewpoint). */
export function buildValidationDataset(samplesPerCell = 6): ValidationSample[] {
  const rand = lcg(42);
  const out: ValidationSample[] = [];
  const phases: Phase[] = ['acceleration', 'max_velocity'];
  const views: Viewpoint[] = ['side', 'oblique', 'head-on'];

  for (const phase of phases) {
    for (const viewpoint of views) {
      for (let i = 0; i < samplesPerCell; i++) {
        const truth: Record<string, number> = { ...TRUTH[phase] };
        const predicted: Record<string, number> = {};
        for (const key of Object.keys(truth) as MetricKey[]) {
          const b = biasFor(key, phase, viewpoint);
          const jitter = rand() * b * 0.5;
          predicted[key] = round(truth[key] + b + jitter);
        }
        out.push({ clipId: `${phase}-${viewpoint}-${i}`, phase, viewpoint, truth, predicted });
      }
    }
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;
