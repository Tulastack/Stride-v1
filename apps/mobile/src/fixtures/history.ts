// Multi-upload history fixture (PROMPT F.5 briefing + F.6 progress).
// Same metric keys across uploads so deltas/trends compute. Designed so knee_drive
// improves, trunk_lean regresses, and one upload's hip is low-confidence (gated).
import type { AnalysisResult } from '../types/analysis';

function band(value: number, conf: number, half = 2) {
  return { value, low: Math.round((value - half) * 10) / 10, high: Math.round((value + half) * 10) / 10, confidence: conf };
}

const baseFlaw = (id: string, name: string, sev: 1 | 2 | 3, value: number, normal: [number, number], conf: number) => ({
  id,
  name,
  phase: 'acceleration' as const,
  severity: sev,
  plainExplanation: `${name} is outside the typical range.`,
  evidence: {
    frameTimestampMs: 600,
    jointAngles3D: { trunk_lean: value, knee_drive: 80, hip_extension: 160 },
    measured: band(value, conf),
    normalRange: normal,
    viewpointPenalty: 1 - conf,
  },
});

export const uploadOne: AnalysisResult = {
  id: 'upload-1',
  phase: 'acceleration',
  summary: 'Baseline run logged.',
  flaws: [baseFlaw('flaw-low-knee', 'Low knee drive', 2, 70, [85, 100], 0.88)],
  recommendations: [
    { flawId: 'flaw-low-knee', drillId: 'high-knee-switch', drillName: 'High-knee wall switches', cue: 'Punch the knee up higher than normal.', demoAssetId: 'demo-high-knee-switch', sets: 3, reps: 10, rationale: 'Raises knee-drive height.' },
  ],
  metrics: [
    { key: 'knee_drive', measured: band(70, 0.88), unit: 'deg', normalRange: [85, 100], comparableAcrossViews: true },
    { key: 'trunk_lean', measured: band(44, 0.9), unit: 'deg', normalRange: [40, 50], comparableAcrossViews: true },
    { key: 'cadence_spm', measured: band(244, 0.9, 4), unit: 'spm', normalRange: [240, 260], comparableAcrossViews: true },
    { key: 'hip_extension', measured: band(168, 0.85), unit: 'deg', normalRange: [165, 180], comparableAcrossViews: true },
  ],
  captureQuality: { overall: 0.9, fps: 120, motionBlur: 'low', framing: 'full', perMetricUsable: { knee_drive: true, trunk_lean: true, cadence_spm: true, hip_extension: true } },
  reconstructionMethod: '3d-mono',
  createdAt: '2026-01-01T10:00:00.000Z',
};

export const uploadTwo: AnalysisResult = {
  id: 'upload-2',
  phase: 'acceleration',
  summary: 'Knee drive up, trunk lean drifted.',
  flaws: [baseFlaw('flaw-trunk', 'Trunk too upright', 1, 36, [40, 50], 0.9)],
  recommendations: [
    { flawId: 'flaw-trunk', drillId: 'wall-drives', drillName: 'Wall drives', cue: 'Stay lower than normal.', demoAssetId: 'demo-wall-drives', sets: 3, reps: 8, rationale: 'Sustains forward lean.' },
  ],
  metrics: [
    { key: 'knee_drive', measured: band(82, 0.89), unit: 'deg', normalRange: [85, 100], comparableAcrossViews: true },
    { key: 'trunk_lean', measured: band(36, 0.9), unit: 'deg', normalRange: [40, 50], comparableAcrossViews: true },
    { key: 'cadence_spm', measured: band(250, 0.91, 4), unit: 'spm', normalRange: [240, 260], comparableAcrossViews: true },
    // hip low-confidence on this upload -> delta should be gated as not comparable
    { key: 'hip_extension', measured: band(170, 0.34, 18), unit: 'deg', normalRange: [165, 180], comparableAcrossViews: true },
  ],
  captureQuality: { overall: 0.6, fps: 120, motionBlur: 'med', framing: 'full', perMetricUsable: { knee_drive: true, trunk_lean: true, cadence_spm: true, hip_extension: false }, primaryNudge: 'Hip data was low-confidence — re-film from a side-ish angle.' },
  reconstructionMethod: '3d-mono',
  createdAt: '2026-01-08T10:00:00.000Z',
};

export const historyFixture: AnalysisResult[] = [uploadOne, uploadTwo];
