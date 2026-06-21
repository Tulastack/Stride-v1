// Biomechanics engine — public surface.
export type { BiomechanicsEngine } from './engine.js';
export { BiomechanicsEngineImpl, ReducedBiomechanicsEngine } from './engine.js';
export { detectKeypoints } from './stage1_detect.js';
export { runStage1Hygiene, estimateCameraAzimuth } from './stage1_pipeline.js';
export { assembleAnalysisFromFrames, type AssembleContext } from './engine.js';
export { liftAndFit, loadWhamOpenCapSidecar } from './stage23_lift_fit.js';
export { loadFrames3dSidecar } from './loadFrames3d.js';
export { loadCaptureManifest } from './capture/loadManifest.js';
export * from './types.js';
export { canonicalize, bodyBasis } from './stage4_canonicalize.js';
export { computeMetrics, detectStances, trunkLeanDeg, thighElevationDeg } from './stage5_metrics.js';
export { metricConfidence, viewpointPenalty } from './stage6_confidence.js';
export { assessCapture, USABLE_CONFIDENCE_THRESHOLD } from './stage7_capture.js';
export { PRECOMPUTED_CLIPS, loadPrecomputed, sideAccelClip, headOnMaxVClip } from './precomputed.js';
