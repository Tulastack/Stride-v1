// Drill library (PROMPT F.4) — covers the core sprint flaw taxonomy. Every drill
// has a real demoAssetId (the visual demonstration of correct form). The
// recommendation engine maps a detected flaw -> one of these drills.

export type TargetPhase = 'acceleration' | 'max_velocity' | 'general';

export interface Drill {
  id: string;
  name: string;
  /** Over-emphasis cue, phrased "...than normal" to drive the correction. */
  cue: string;
  /** Visual demonstration of correct form (looping clip / lottie ref). Required. */
  demoAssetId: string;
  sets: number;
  reps: number;
  targetPhase: TargetPhase;
  /** One-line "why this fixes that flaw". */
  rationale: string;
}

export const DRILLS: Record<string, Drill> = {
  'wall-drives': {
    id: 'wall-drives',
    name: 'Wall drives',
    cue: 'Stay lower and more horizontal than feels normal.',
    demoAssetId: 'demo-wall-drives',
    sets: 3,
    reps: 8,
    targetPhase: 'acceleration',
    rationale: 'Trains a sustained forward shin/torso angle so you stop popping up early.',
  },
  'dribble-to-build': {
    id: 'dribble-to-build',
    name: 'Dribble-to-build build-ups',
    cue: 'Keep the heel cycling lower and quicker than normal.',
    demoAssetId: 'demo-dribble-to-build',
    sets: 4,
    reps: 6,
    targetPhase: 'acceleration',
    rationale: 'Grooves a gradual rise out of the drive phase instead of standing up.',
  },
  'wall-posture-pushback': {
    id: 'wall-posture-pushback',
    name: 'Wall posture push-backs',
    cue: 'Push the ground back under your hips harder than normal.',
    demoAssetId: 'demo-wall-posture-pushback',
    sets: 3,
    reps: 6,
    targetPhase: 'acceleration',
    rationale: 'Teaches the foot to land under the hips, removing first-step braking.',
  },
  'banded-starts': {
    id: 'banded-starts',
    name: 'Resisted banded starts',
    cue: 'Punch the ground and rip off it faster than normal.',
    demoAssetId: 'demo-banded-starts',
    sets: 4,
    reps: 5,
    targetPhase: 'acceleration',
    rationale: 'Builds horizontal force so the feet stop spinning without traction.',
  },
  'a-skips': {
    id: 'a-skips',
    name: 'A-skips',
    cue: 'Snap the foot down under the hip quicker than normal.',
    demoAssetId: 'demo-a-skips',
    sets: 3,
    reps: 20,
    targetPhase: 'general',
    rationale: 'Improves heel recovery and cyclical mechanics.',
  },
  wickets: {
    id: 'wickets',
    name: 'Wicket runs',
    cue: 'Hit every gap with quicker, snappier feet than normal.',
    demoAssetId: 'demo-wickets',
    sets: 3,
    reps: 6,
    targetPhase: 'max_velocity',
    rationale: 'Rhythms up cadence and front-side mechanics at speed.',
  },
  'high-knee-switch': {
    id: 'high-knee-switch',
    name: 'High-knee wall switches',
    cue: 'Punch the knee up to hip height — higher than feels normal.',
    demoAssetId: 'demo-high-knee-switch',
    sets: 3,
    reps: 10,
    targetPhase: 'general',
    rationale: 'Raises knee-drive height so the stride lengthens and force applies sooner.',
  },
  'posture-march': {
    id: 'posture-march',
    name: 'Tall posture marches',
    cue: 'Run taller with hips further forward than normal.',
    demoAssetId: 'demo-posture-march',
    sets: 3,
    reps: 8,
    targetPhase: 'max_velocity',
    rationale: 'Restores a neutral torso so you can apply force downward at speed.',
  },
};

/**
 * Map a detected flaw id (as emitted by the engine/fixtures) to its primary
 * drill. The flaw-id naming follows `flaw-<metric>` plus the legacy taxonomy.
 */
export const FLAW_TO_DRILL: Record<string, string> = {
  // metric-derived flaw ids (engine)
  'flaw-trunk-lean': 'wall-drives',
  'flaw-knee-drive': 'high-knee-switch',
  'flaw-hip-extension': 'dribble-to-build',
  'flaw-contact-time-ms': 'banded-starts',
  'flaw-cadence-spm': 'wickets',
  // taxonomy flaw ids (fixtures / product language)
  'flaw-pop-up': 'wall-drives',
  'flaw-low-knee': 'high-knee-switch',
  'flaw-overstride': 'wall-posture-pushback',
  'flaw-hip-ext': 'dribble-to-build',
  'flaw-trunk-late': 'posture-march',
  'popping-up-early': 'wall-drives',
  'overstride-first-step': 'wall-posture-pushback',
  'spinning-wheels': 'banded-starts',
  'poor-heel-recovery': 'a-skips',
  'low-knee-drive': 'high-knee-switch',
  'trunk-lean': 'posture-march',
};

export function getDrill(drillId: string): Drill | undefined {
  return DRILLS[drillId];
}

export function drillForFlaw(flawId: string): Drill | undefined {
  const id = FLAW_TO_DRILL[flawId];
  return id ? DRILLS[id] : undefined;
}

/** Demo assets registry — placeholder refs now, but the wiring is real. */
export const DEMO_ASSETS: Record<string, { kind: 'lottie' | 'video'; ref: string }> = Object.fromEntries(
  Object.values(DRILLS).map((d) => [d.demoAssetId, { kind: 'lottie' as const, ref: `assets/demos/${d.demoAssetId}.json` }])
);

export function resolveDemoAsset(demoAssetId: string): { kind: 'lottie' | 'video'; ref: string } | undefined {
  return DEMO_ASSETS[demoAssetId];
}
