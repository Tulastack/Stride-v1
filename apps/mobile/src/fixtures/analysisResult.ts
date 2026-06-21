// Deterministic AnalysisResult fixtures for the mobile UI (offline fallback + tests).
// Mirrors apps/api/src/analysis/fixtures.ts: one HIGH-quality side capture and one
// LOW-quality head-on capture (hip low-confidence + a single nudge).
import type { AnalysisResult } from '../types/analysis';

export const highQualitySideResult: AnalysisResult = {
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
  ],
  recommendations: [
    {
      flawId: 'flaw-pop-up',
      drillId: 'wall-drives',
      drillName: 'Wall drives',
      cue: 'Stay lower and more horizontal than feels normal.',
      demoAssetId: 'demo-wall-drives',
      sets: 3,
      reps: 8,
      rationale: 'Trains a sustained forward shin/torso angle so you stop popping up early.',
    },
    {
      flawId: 'flaw-low-knee',
      drillId: 'high-knee-switch',
      drillName: 'High-knee wall switches',
      cue: 'Punch the knee up to hip height — higher than feels normal.',
      demoAssetId: 'demo-high-knee-switch',
      sets: 3,
      reps: 10,
      rationale: 'Raises knee-drive height so the stride lengthens and force applies sooner.',
    },
  ],
  metrics: [
    { key: 'trunk_lean', measured: { value: 61.5, low: 59.8, high: 63.2, confidence: 0.91 }, unit: 'deg', normalRange: [40, 50], comparableAcrossViews: true },
    { key: 'knee_drive', measured: { value: 78.1, low: 75.6, high: 80.6, confidence: 0.88 }, unit: 'deg', normalRange: [85, 100], comparableAcrossViews: true },
    { key: 'hip_extension', measured: { value: 168.2, low: 165.9, high: 170.5, confidence: 0.9 }, unit: 'deg', normalRange: [165, 180], comparableAcrossViews: true },
    { key: 'cadence_spm', measured: { value: 248, low: 244, high: 252, confidence: 0.92 }, unit: 'spm', normalRange: [240, 260], comparableAcrossViews: true },
  ],
  captureQuality: {
    overall: 0.92,
    fps: 120,
    motionBlur: 'low',
    framing: 'full',
    perMetricUsable: { trunk_lean: true, knee_drive: true, hip_extension: true, cadence_spm: true },
  },
  reconstructionMethod: '3d-mono',
  createdAt: '2026-01-15T10:30:00.000Z',
};

export const lowQualityHeadOnResult: AnalysisResult = {
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
        measured: { value: 158.0, low: 140.0, high: 176.0, confidence: 0.34 },
        normalRange: [170, 185],
        viewpointPenalty: 0.86,
      },
    },
  ],
  recommendations: [
    {
      flawId: 'flaw-hip-ext',
      drillId: 'dribble-to-build',
      drillName: 'Dribble-to-bound build-ups',
      cue: 'Feel the back leg finish long behind you.',
      demoAssetId: 'demo-dribble-to-build',
      sets: 4,
      reps: 6,
      rationale: 'Cues full hip extension at speed so the back leg completes its push.',
    },
  ],
  metrics: [
    { key: 'trunk_lean', measured: { value: 7.5, low: 5.2, high: 9.8, confidence: 0.79 }, unit: 'deg', normalRange: [-3, 3], comparableAcrossViews: true },
    { key: 'hip_extension', measured: { value: 158.0, low: 140.0, high: 176.0, confidence: 0.34 }, unit: 'deg', normalRange: [170, 185], comparableAcrossViews: true },
    { key: 'cadence_spm', measured: { value: 256, low: 250, high: 262, confidence: 0.82 }, unit: 'spm', normalRange: [250, 270], comparableAcrossViews: true },
  ],
  captureQuality: {
    overall: 0.38,
    fps: 60,
    motionBlur: 'high',
    framing: 'partial',
    perMetricUsable: { trunk_lean: true, hip_extension: false, cadence_spm: true },
    primaryNudge:
      'Hip data is low-confidence from this head-on angle — turn ~30° next time for trustworthy hip extension.',
  },
  reconstructionMethod: '3d-mono',
  createdAt: '2026-01-15T11:05:00.000Z',
};
