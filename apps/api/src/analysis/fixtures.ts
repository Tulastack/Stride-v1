// Deterministic AnalysisResult fixtures for LocalAnalysisProvider 'fixture' mode.
//
// These power all UI work and tests with no AWS and no GPU. Per the addendum
// they must exercise BOTH capture-quality paths:
//   • HIGH-quality side capture  -> tight bands, all metrics usable, no nudge.
//   • LOW-quality head-on capture -> hip metric low-confidence + a single nudge.
//
// Every flaw carries 3D canonical evidence + a measured band; every metric is
// canonical-frame (comparableAcrossViews); every recommendation references a
// real flawId and carries a demoAssetId. (Enforced by validate.ts.)

import type { AnalysisResult } from '@stride/types';

/** HIGH-quality, side-on, 120fps acceleration capture — everything trusted. */
export const highQualitySideFixture: AnalysisResult = {
  id: 'fixture-accel-side-hq',
  phase: 'acceleration',
  summary:
    'Strong drive phase. You stand up a touch early and your knee drive is slightly low — both are quick fixes.',
  flaws: [
    {
      id: 'flaw-pop-up',
      name: 'Popping up early',
      phase: 'acceleration',
      severity: 2,
      plainExplanation:
        'You raise your torso toward vertical before the drive phase is finished, cutting your push short.',
      evidence: {
        frameTimestampMs: 540,
        jointAngles3D: { trunk_lean: 61.5, hip_extension: 168.2, knee_drive: 92.4 },
        measured: { value: 61.5, low: 59.8, high: 63.2, confidence: 0.91 },
        normalRange: [40, 50],
        viewpointPenalty: 0.08,
      },
    },
    {
      id: 'flaw-low-knee',
      name: 'Low knee drive',
      phase: 'acceleration',
      severity: 1,
      plainExplanation:
        'Your front knee does not come up far enough, shortening your stride and applying force later.',
      evidence: {
        frameTimestampMs: 720,
        jointAngles3D: { knee_drive: 78.1, hip_extension: 160.4, trunk_lean: 47.0 },
        measured: { value: 78.1, low: 75.6, high: 80.6, confidence: 0.88 },
        normalRange: [85, 100],
        viewpointPenalty: 0.12,
      },
    },
    {
      id: 'flaw-overstride',
      name: 'Overstriding the first step',
      phase: 'acceleration',
      severity: 1,
      plainExplanation:
        'Your first foot lands slightly ahead of your hips, creating a small braking force out of the blocks.',
      evidence: {
        frameTimestampMs: 300,
        jointAngles3D: { shin_angle: 71.0, knee_drive: 88.0, hip_extension: 150.2 },
        measured: { value: 71.0, low: 68.5, high: 73.5, confidence: 0.86 },
        normalRange: [55, 65],
        viewpointPenalty: 0.15,
      },
    },
  ],
  recommendations: [
    {
      flawId: 'flaw-pop-up',
      drillId: 'drill-wall-drive',
      drillName: 'Wall drives',
      cue: 'Stay LOWER and more horizontal than feels natural — drive the wall away.',
      demoAssetId: 'demo-wall-drive',
      sets: 3,
      reps: 8,
      rationale: 'Trains a sustained forward shin and torso angle so you stop standing up early.',
    },
    {
      flawId: 'flaw-low-knee',
      drillId: 'drill-high-knee-switch',
      drillName: 'High-knee wall switches',
      cue: 'Punch the knee UP to hip height — higher than feels comfortable.',
      demoAssetId: 'demo-high-knee-switch',
      sets: 3,
      reps: 10,
      rationale: 'Grooves a higher knee-drive position so your stride lengthens and force applies sooner.',
    },
    {
      flawId: 'flaw-overstride',
      drillId: 'drill-wall-posture-pushback',
      drillName: 'Wall posture push-backs',
      cue: 'Push the ground BACK under your hips, not out in front.',
      demoAssetId: 'demo-wall-posture-pushback',
      sets: 3,
      reps: 6,
      rationale: 'Teaches the foot to land under the hips, removing the first-step braking force.',
    },
  ],
  metrics: [
    { key: 'trunk_lean', measured: { value: 61.5, low: 59.8, high: 63.2, confidence: 0.91 }, unit: '°', normalRange: [40, 50], comparableAcrossViews: true },
    { key: 'knee_drive', measured: { value: 78.1, low: 75.6, high: 80.6, confidence: 0.88 }, unit: '°', normalRange: [85, 100], comparableAcrossViews: true },
    { key: 'hip_extension', measured: { value: 168.2, low: 165.9, high: 170.5, confidence: 0.9 }, unit: '°', normalRange: [165, 180], comparableAcrossViews: true },
    { key: 'contact_time_ms', measured: { value: 112, low: 106, high: 118, confidence: 0.84 }, unit: 'ms', normalRange: [90, 110], comparableAcrossViews: true },
    { key: 'cadence_spm', measured: { value: 248, low: 244, high: 252, confidence: 0.92 }, unit: 'spm', normalRange: [240, 260], comparableAcrossViews: true },
  ],
  captureQuality: {
    overall: 0.92,
    fps: 120,
    motionBlur: 'low',
    framing: 'full',
    perMetricUsable: {
      trunk_lean: true,
      knee_drive: true,
      hip_extension: true,
      contact_time_ms: true,
      cadence_spm: true,
    },
    // No nudge: capture is good, so we never nag.
  },
  reconstructionMethod: '3d-mono',
  createdAt: '2026-01-15T10:30:00.000Z',
};

/** LOW-quality, head-on, 60fps max-velocity capture — hip data not trustworthy. */
export const lowQualityHeadOnFixture: AnalysisResult = {
  id: 'fixture-maxv-headon-lq',
  phase: 'max_velocity',
  summary:
    'We could read your trunk position at top speed, but this head-on angle hides your hip extension — turn ~30° next time to confirm it.',
  flaws: [
    {
      id: 'flaw-hip-ext',
      name: 'Limited hip extension',
      phase: 'max_velocity',
      severity: 2,
      plainExplanation:
        'Your hip may not be fully extending behind you at top speed, but this filming angle makes that hard to measure confidently.',
      evidence: {
        frameTimestampMs: 1180,
        jointAngles3D: { hip_extension: 158.0, knee_drive: 101.0, trunk_lean: 7.5 },
        // Wide band + low confidence + high viewpoint penalty: head-on is degenerate for hip.
        measured: { value: 158.0, low: 140.0, high: 176.0, confidence: 0.34 },
        normalRange: [170, 185],
        viewpointPenalty: 0.86,
      },
    },
    {
      id: 'flaw-trunk-late',
      name: 'Trunk slightly behind vertical',
      phase: 'max_velocity',
      severity: 1,
      plainExplanation:
        'At top speed your torso leans back a little past vertical, which can reduce how much force you put down.',
      evidence: {
        frameTimestampMs: 1240,
        jointAngles3D: { trunk_lean: 7.5, hip_extension: 158.0, knee_drive: 101.0 },
        measured: { value: 7.5, low: 5.2, high: 9.8, confidence: 0.79 },
        normalRange: [-3, 3],
        viewpointPenalty: 0.31,
      },
    },
  ],
  recommendations: [
    {
      flawId: 'flaw-hip-ext',
      drillId: 'drill-dribble-bound',
      drillName: 'Dribble-to-bound build-ups',
      cue: 'Feel the back leg finish LONG behind you before it recovers.',
      demoAssetId: 'demo-dribble-bound',
      sets: 4,
      reps: 6,
      rationale: 'Cues full hip extension at speed so the back leg completes its push.',
    },
    {
      flawId: 'flaw-trunk-late',
      drillId: 'drill-posture-march',
      drillName: 'Tall posture marches',
      cue: 'Run TALL with hips forward — ribs stacked over your pelvis.',
      demoAssetId: 'demo-posture-march',
      sets: 3,
      reps: 8,
      rationale: 'Restores a neutral, slightly forward torso so you can apply force downward.',
    },
  ],
  metrics: [
    { key: 'trunk_lean', measured: { value: 7.5, low: 5.2, high: 9.8, confidence: 0.79 }, unit: '°', normalRange: [-3, 3], comparableAcrossViews: true },
    { key: 'knee_drive', measured: { value: 101.0, low: 96.0, high: 106.0, confidence: 0.71 }, unit: '°', normalRange: [95, 115], comparableAcrossViews: true },
    // Hip extension: wide band, low confidence — head-on view is degenerate for this angle.
    { key: 'hip_extension', measured: { value: 158.0, low: 140.0, high: 176.0, confidence: 0.34 }, unit: '°', normalRange: [170, 185], comparableAcrossViews: true },
    // Contact time: head-on cannot resolve foot-ground timing well at 60fps.
    { key: 'contact_time_ms', measured: { value: 98, low: 78, high: 118, confidence: 0.29 }, unit: 'ms', normalRange: [80, 100], comparableAcrossViews: true },
    { key: 'cadence_spm', measured: { value: 256, low: 250, high: 262, confidence: 0.82 }, unit: 'spm', normalRange: [250, 270], comparableAcrossViews: true },
  ],
  captureQuality: {
    overall: 0.38,
    fps: 60,
    motionBlur: 'high',
    framing: 'partial',
    perMetricUsable: {
      trunk_lean: true,
      knee_drive: true,
      hip_extension: false,
      contact_time_ms: false,
      cadence_spm: true,
    },
    primaryNudge:
      'Hip data is low-confidence from this head-on angle — turn ~30° next time for trustworthy hip extension.',
  },
  reconstructionMethod: '3d-mono',
  createdAt: '2026-01-15T11:05:00.000Z',
};

/** All fixtures keyed by id, for deterministic lookup. */
export const ANALYSIS_FIXTURES: Record<string, AnalysisResult> = {
  [highQualitySideFixture.id]: highQualitySideFixture,
  [lowQualityHeadOnFixture.id]: lowQualityHeadOnFixture,
};

/**
 * Deterministically pick a fixture from the capture's video URI ("seed").
 * Head-on / low-quality markers -> the low-quality fixture; otherwise the
 * high-quality side fixture. This lets tests and the UI exercise both paths.
 */
export function pickFixture(localVideoUri: string): AnalysisResult {
  const uri = localVideoUri.toLowerCase();
  if (/(headon|head-on|lowq|low-q)/.test(uri)) {
    return lowQualityHeadOnFixture;
  }
  return highQualitySideFixture;
}
