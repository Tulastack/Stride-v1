// Biomechanics engine — full capture-agnostic pipeline (Stages 0–7).
//
// Production path: Stage 1 hygiene → WHAM Stage 2 → OpenCap Stage 3 (GPU sidecar
// from ml-worker) → Stages 4–7 metrics/confidence on the API.
// Missing sidecars fail loudly — no inline synthetic lift.

import type {
  AnalysisResult,
  Phase,
  Flaw,
  DrillRec,
  Metric,
  Severity,
  CameraIntrinsics,
  ReconstructionMethod,
} from '@stride/types';
import { loadCaptureManifest } from './capture/loadManifest.js';
import { detectKeypoints } from './stage1_detect.js';
import { runStage1Hygiene, estimateCameraAzimuth } from './stage1_pipeline.js';
import { liftAndFit } from './stage23_lift_fit.js';
import { loadFrames3dSidecar } from './loadFrames3d.js';
import { computeMetrics, trunkLeanDeg, thighElevationDeg, type ComputedMetric } from './stage5_metrics.js';
import { metricConfidence, type MetricConfidence } from './stage6_confidence.js';
import { assessCapture } from './stage7_capture.js';
import type { Frame3D, PrecomputedClip } from './types.js';
import type { Vec3 } from './math.js';
import { metricTrustStatus } from '../validation/trust.js';
import { PipelineInputError } from '../errors.js';
import { explainMetric } from './metricExplanations.js';

export interface BiomechanicsEngine {
  analyze(videoPath: string, gyroPath?: string, intrinsics?: CameraIntrinsics): AnalysisResult;
}

const DRILLS: Record<string, Omit<DrillRec, 'flawId'>> = {
  trunk_lean: { drillId: 'drill-wall-drive', drillName: 'Wall drives', cue: 'Stay lower and more horizontal than feels natural.', demoAssetId: 'demo-wall-drive', sets: 3, reps: 8, rationale: 'Trains a sustained forward shin/torso angle.' },
  knee_drive: { drillId: 'drill-high-knee-switch', drillName: 'High-knee wall switches', cue: 'Punch the knee up to hip height.', demoAssetId: 'demo-high-knee-switch', sets: 3, reps: 10, rationale: 'Grooves a higher knee-drive position.' },
  hip_extension: { drillId: 'drill-dribble-bound', drillName: 'Dribble-to-bound build-ups', cue: 'Feel the back leg finish long behind you.', demoAssetId: 'demo-dribble-bound', sets: 4, reps: 6, rationale: 'Cues full hip extension at speed.' },
  contact_time_ms: { drillId: 'drill-banded-starts', drillName: 'Resisted banded starts', cue: 'Punch the ground and get off it fast.', demoAssetId: 'demo-banded-starts', sets: 4, reps: 5, rationale: 'Shortens ground-contact time.' },
  cadence_spm: { drillId: 'drill-wickets', drillName: 'Wicket runs', cue: 'Quick feet, snap each step.', demoAssetId: 'demo-wickets', sets: 3, reps: 6, rationale: 'Raises stride frequency.' },
};

const NAMES: Record<string, string> = {
  trunk_lean: 'Trunk angle off-target',
  knee_drive: 'Low knee drive',
  hip_extension: 'Limited hip extension',
  contact_time_ms: 'Long ground contact',
  cadence_spm: 'Cadence off-target',
};

function deviation(value: number, [lo, hi]: [number, number]): number {
  const width = Math.max(hi - lo, 1);
  if (value < lo) return (lo - value) / width;
  if (value > hi) return (value - hi) / width;
  return 0;
}

function severityFrom(dev: number): Severity {
  return dev > 0.5 ? 3 : dev > 0.2 ? 2 : 1;
}

function viewpointBucket(azimuthDeg: number): 'side' | 'oblique' | 'head-on' {
  if (azimuthDeg < 30) return 'side';
  if (azimuthDeg < 60) return 'oblique';
  return 'head-on';
}

export interface AssembleContext {
  clipId: string;
  fps: number;
  frames: Frame3D[];
  cameraAzimuthDeg: number;
  motionBlur: 'low' | 'med' | 'high';
  framing: 'full' | 'partial';
  meanKeypointConfidence: number;
  meanReconResidual: number;
  reconstructionMethod?: ReconstructionMethod;
  /** Measured world-up (pose frame) for gravity-anchored canonicalization. */
  worldUp?: Vec3;
}

export class BiomechanicsEngineImpl implements BiomechanicsEngine {
  analyze(videoPath: string, gyroPath?: string, intrinsics?: CameraIntrinsics): AnalysisResult {
    const manifest = loadCaptureManifest(videoPath, gyroPath);
    if (intrinsics) manifest.intrinsics = intrinsics;

    // Fast path: WHAM+OpenCap sidecar already produced by ml-worker
    const sidecar = loadFrames3dSidecar(videoPath, gyroPath?.replace(/\.gyro\.json$/, '.frames3d.json'));
    if (sidecar) {
      return assembleAnalysisFromFrames({
        clipId: `wham-${manifest.videoPath.split('/').pop()?.replace(/\W/g, '-') ?? 'clip'}`,
        fps: sidecar.fps,
        frames: sidecar.frames,
        cameraAzimuthDeg: sidecar.cameraAzimuthDeg,
        motionBlur: manifest.motionBlur,
        framing: manifest.framing,
        meanKeypointConfidence: sidecar.meanKeypointConfidence,
        meanReconResidual: sidecar.meanReconResidual,
        reconstructionMethod: sidecar.reconstructionMethod,
        worldUp: manifest.gravityWorld,
      });
    }

    // Stage 1: detect + hygiene on real input
    const raw = detectKeypoints(manifest);
    const stage1 = runStage1Hygiene(raw.frames, raw.fps);
    if (stage1.frames.length === 0) {
      throw new PipelineInputError(`Stage 1 produced zero frames for "${videoPath}"`);
    }

    manifest.fps = stage1.fps;
    manifest.cameraAzimuthDeg =
      manifest.cameraAzimuthDeg ?? estimateCameraAzimuth(stage1.frames);

    // Stage 2–3: WHAM + OpenCap (sidecar / Python) with CPU fallback inside liftAndFit
    const lift = liftAndFit({
      videoPath: manifest.videoPath,
      keypoints: stage1.frames,
      fps: stage1.fps,
      manifest,
      sidecarPath: gyroPath,
    });

    return assembleAnalysisFromFrames({
      clipId: `live-${manifest.videoPath.split('/').pop()?.replace(/\W/g, '-') ?? 'clip'}`,
      fps: stage1.fps,
      frames: lift.frames,
      cameraAzimuthDeg: lift.cameraAzimuthDeg,
      motionBlur: manifest.motionBlur,
      framing: manifest.framing,
      meanKeypointConfidence: stage1.meanKeypointConfidence,
      meanReconResidual: lift.meanReconResidual,
      reconstructionMethod: lift.reconstructionMethod,
      worldUp: manifest.gravityWorld,
    });
  }
}

/** Stages 4–7: canonical metrics, flaws, capture quality from WHAM/OpenCap frames. */
export function assembleAnalysisFromFrames(ctx: AssembleContext): AnalysisResult {
  const { frames, fps, cameraAzimuthDeg } = ctx;
  const { canonical, metrics } = computeMetrics(frames, fps, ctx.worldUp);
  const view = viewpointBucket(cameraAzimuthDeg);

  const withConfidence: MetricConfidence[] = metrics.map((m) =>
    metricConfidence(m, {
      meanKeypointConfidence: ctx.meanKeypointConfidence,
      reconResidual: ctx.meanReconResidual,
      cameraAzimuthDeg,
      fps,
    })
  );

  const phase: Phase = cameraAzimuthDeg < 45 ? 'acceleration' : 'max_velocity';
  const captureQuality = assessCapture(withConfidence, {
    fps,
    motionBlur: ctx.motionBlur,
    framing: ctx.framing,
  });

  // Trust is the AND of three gates: (1) type-weighted Stage 6 trustHint
  // (tier + fps + viewpoint), (2) the offline per-viewpoint validation table,
  // and (3) a confidence floor. Never stamp a low-confidence number "trusted".
  const CONFIDENCE_TRUST_FLOOR = 0.6;
  const outMetrics: Metric[] = withConfidence.map((mc) => {
    const tableTrust = metricTrustStatus(
      mc.metric.key as import('../validation/harness.js').MetricKey,
      view,
    );
    const trustStatus =
      mc.trustHint === 'experimental' ||
      mc.band.confidence < CONFIDENCE_TRUST_FLOOR ||
      tableTrust === 'experimental'
        ? 'experimental'
        : 'trusted';
    return {
      key: mc.metric.key,
      measured: mc.band,
      unit: mc.metric.unit,
      normalRange: mc.metric.normalRange,
      comparableAcrossViews: true,
      trustStatus,
    };
  });

  const flaws: Flaw[] = [];
  const recommendations: DrillRec[] = [];
  for (const mc of withConfidence) {
    const dev = deviation(mc.metric.value, mc.metric.normalRange);
    if (dev <= 0) continue;
    const id = `flaw-${mc.metric.key.replace(/_/g, '-')}`;
    flaws.push({
      id,
      name: NAMES[mc.metric.key] ?? mc.metric.key,
      phase,
      severity: severityFrom(dev),
      plainExplanation: explain(mc.metric),
      evidence: {
        frameTimestampMs: frames[mc.metric.evidenceFrame]?.timestampMs ?? 0,
        jointAngles3D: {
          trunk_lean: round(trunkLeanDeg(canonical[mc.metric.evidenceFrame])),
          l_thigh_elev: round(thighElevationDeg(canonical[mc.metric.evidenceFrame], 'l')),
          r_thigh_elev: round(thighElevationDeg(canonical[mc.metric.evidenceFrame], 'r')),
        },
        measured: mc.band,
        normalRange: mc.metric.normalRange,
        viewpointPenalty: mc.viewpointPenalty,
      },
    });
    const drill = DRILLS[mc.metric.key];
    if (drill) recommendations.push({ flawId: id, ...drill });
  }

  return {
    id: `analysis-${ctx.clipId}`,
    phase,
    summary: summarize(phase, flaws.length, captureQuality.primaryNudge),
    flaws,
    recommendations,
    metrics: outMetrics,
    captureQuality,
    reconstructionMethod: ctx.reconstructionMethod ?? '3d-mono',
    createdAt: new Date().toISOString(),
  };
}

/** @deprecated Use BiomechanicsEngineImpl — alias for existing tests. */
export class ReducedBiomechanicsEngine extends BiomechanicsEngineImpl {
  /** Run Stages 4–7 directly on a precomputed 3D clip (unit tests). */
  run(clip: PrecomputedClip): AnalysisResult {
    return assembleAnalysisFromFrames({
      clipId: clip.clipId,
      fps: clip.fps,
      frames: clip.frames,
      cameraAzimuthDeg: clip.cameraAzimuthDeg,
      motionBlur: clip.motionBlur,
      framing: clip.framing,
      meanKeypointConfidence:
        clip.frames.reduce((a, f) => a + f.keypointConfidence, 0) / clip.frames.length,
      meanReconResidual:
        clip.frames.reduce((a, f) => a + f.reconResidual, 0) / clip.frames.length,
      reconstructionMethod: '3d-mono',
    });
  }
}

function explain(m: ComputedMetric): string {
  const readable = explainMetric(m.key, m.value, m.unit, m.normalRange);
  if (readable) return readable;
  const dir = m.value < m.normalRange[0] ? 'below' : 'above';
  return `Your ${m.key.replace(/_/g, ' ')} (${m.value}${m.unit}) is ${dir} the typical range of ${m.normalRange[0]}–${m.normalRange[1]}${m.unit}.`;
}

function summarize(phase: Phase, nFlaws: number, nudge?: string): string {
  const head =
    nFlaws === 0
      ? `Clean ${phase.replace('_', ' ')} mechanics — nothing flagged this run.`
      : `We found ${nFlaws} thing${nFlaws > 1 ? 's' : ''} to work on in your ${phase.replace('_', ' ')} phase.`;
  return nudge ? `${head} ${nudge}` : head;
}

const round = (x: number) => Math.round(x * 10) / 10;
