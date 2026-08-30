// Progressive drill programs (targeted plan generation).
//
// Approving a drill suggestion used to create a single one-off calendar event.
// That produced a list of disconnected activities, not a plan that actually
// builds a skill over time. This turns one approval into a real multi-week
// block: a fixed frequency per week, sessions spaced so the same drill never
// lands on back-to-back days, and volume that progresses instead of staying
// flat for the whole block.

export interface ProgramSession {
  title: string;
  eventType: 'drill';
  scheduledDate: string; // YYYY-MM-DD
  details: {
    drill_key: string;
    sets: number;
    reps: number;
    cue: string;
    week: number;
    drill_suggestion_id: string;
    why?: string;
    cues?: string[];
  };
}

export interface DrillProgramBase {
  drillKey: string;
  drillName: string;
  cue: string;
  sets: number;
  reps: number;
  why?: string;
  cues?: string[];
}

/** Athlete/flaw context used to shape plan length, frequency and progression.
 * All fields optional — an omitted `athlete` resolves to the original fixed
 * 3-week / 2-session template below, unchanged. */
export interface AthleteProgramInput {
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced' | null;
  isInjured?: boolean | null;
  drillIntensityCap?: 'moderate' | 'full' | null;
  flawSeverity?: 1 | 2 | 3 | null;
}

const DEFAULT_WEEKS = 3;
const DEFAULT_SESSIONS_PER_WEEK = 2;
const DAYS_BETWEEN_SESSIONS = 3;
// Hold volume for the first two weeks to groove the pattern, then step it up —
// a real progression instead of repeating the same session N times.
const DEFAULT_REP_PROGRESSION = [1, 1, 1.25];

function isCapped(athlete?: AthleteProgramInput): boolean {
  return Boolean(athlete?.isInjured) || athlete?.drillIntensityCap === 'moderate';
}

// A newer athlete needs more weeks to groove a movement pattern; a more
// experienced one plateaus on a short block faster. An injury or an explicit
// moderate-intensity cap overrides experience level and shortens the block
// regardless, since duration under load matters more than skill acquisition
// speed when recovering.
function resolveWeeks(athlete?: AthleteProgramInput): number {
  if (!athlete) return DEFAULT_WEEKS;
  if (isCapped(athlete)) return 2;
  switch (athlete.experienceLevel) {
    case 'beginner': return 2;
    case 'advanced': return 4;
    default: return DEFAULT_WEEKS;
  }
}

// A severity-3 flaw (the biggest fault found) gets reinforced more often per
// week than a minor one — same logic as any skill: bigger gap, more reps at
// it. Injury/intensity cap overrides this back down regardless of severity.
function resolveSessionsPerWeek(athlete?: AthleteProgramInput): number {
  if (!athlete) return DEFAULT_SESSIONS_PER_WEEK;
  if (isCapped(athlete)) return Math.min(2, DEFAULT_SESSIONS_PER_WEEK);
  return athlete.flawSeverity === 3 ? 3 : DEFAULT_SESSIONS_PER_WEEK;
}

// Volume progression scales with the plan length: beginners hold flat longer
// (more weeks to groove before adding load), advanced athletes step up
// faster over their longer block. Injured/capped athletes never progress
// past a light 1.1x bump, regardless of week count.
function resolveRepProgression(athlete: AthleteProgramInput | undefined, weeks: number): number[] {
  if (!athlete) return DEFAULT_REP_PROGRESSION;
  if (isCapped(athlete)) return Array(weeks).fill(1).map((_, i) => (i === weeks - 1 ? 1.1 : 1));
  if (athlete.experienceLevel === 'beginner') {
    // flat until the last week, then a modest step
    return Array(weeks).fill(1).map((_, i) => (i === weeks - 1 ? 1.15 : 1));
  }
  if (athlete.experienceLevel === 'advanced') {
    // steady climb across the whole block
    return Array(weeks).fill(0).map((_, i) => 1 + i * 0.15);
  }
  return DEFAULT_REP_PROGRESSION;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the full progressive program for one approved drill suggestion. Pure:
 * same inputs always yield the same output. `athlete` shapes plan length,
 * weekly frequency and progression around the specific athlete and the flaw
 * being addressed — omit it to get the original fixed template.
 */
export function generateDrillProgram(
  base: DrillProgramBase,
  suggestionId: string,
  startDate: string,
  athlete?: AthleteProgramInput,
): ProgramSession[] {
  const weeks = resolveWeeks(athlete);
  const sessionsPerWeek = resolveSessionsPerWeek(athlete);
  const repProgression = resolveRepProgression(athlete, weeks);

  const sessions: ProgramSession[] = [];
  for (let week = 0; week < weeks; week++) {
    const reps = Math.round(base.reps * (repProgression[week] ?? 1));
    for (let session = 0; session < sessionsPerWeek; session++) {
      const dayOffset = week * 7 + session * DAYS_BETWEEN_SESSIONS;
      sessions.push({
        title: base.drillName,
        eventType: 'drill',
        scheduledDate: addDays(startDate, dayOffset),
        details: {
          drill_key: base.drillKey,
          sets: base.sets,
          reps,
          cue: base.cue,
          week: week + 1,
          drill_suggestion_id: suggestionId,
          ...(base.why ? { why: base.why } : {}),
          ...(base.cues ? { cues: base.cues } : {}),
        },
      });
    }
  }
  return sessions;
}

// ─── Phase-based recovery programs ─────────────────────────────────────────
//
// generateDrillProgram() above repeats the SAME exercise at increasing
// volume for the whole block. A recovery program from the offline
// biomechanics research pipeline (metric_biomechanics -> reference_drills
// .recovery_phases) is different in kind, not just degree: it's an ORDERED
// sequence of 4 phases (Stability -> Strength -> Plyometrics & Movement ->
// Back to Sport), each with its own FIXED exercise group that entirely
// replaces the previous phase's group at the boundary. Every athlete who
// gets this metric's flaw goes through the same phase order — phase
// selection is not an athlete-level difficulty choice the way
// AthleteProgramInput shapes generateDrillProgram().

export interface RecoveryExercise {
  name: string;
  sets: number;
  reps: string;
  cue: string;
  rationale: string;
  sourceCitation: string;
}

export interface RecoveryPhase {
  phase: 1 | 2 | 3 | 4;
  name: string;
  durationWeeksMin: number;
  durationWeeksMax: number;
  daysPerWeek: number;
  exercises: RecoveryExercise[];
  advanceCriteria: string;
}

export interface RecoverySession {
  title: string;
  eventType: 'drill';
  scheduledDate: string;
  details: {
    metric_key: string;
    phase: number;
    phase_name: string;
    week_in_phase: number;
    exercises: { name: string; sets: number; reps: string; cue: string }[];
    advance_criteria: string;
    drill_suggestion_id: string;
  };
}

// Even spread of `daysPerWeek` sessions across a 7-day week, e.g. 3/week ->
// day offsets [0, 2, 4] rather than clumping at the start of the week.
function spreadDayOffsets(daysPerWeek: number): number[] {
  const n = Math.max(1, Math.min(7, daysPerWeek));
  const gap = 7 / n;
  return Array.from({ length: n }, (_, i) => Math.round(i * gap));
}

/**
 * Build the full multi-phase recovery program for one approved drill
 * suggestion whose reference_drills row has reviewed recovery_phases. Pure:
 * same inputs always yield the same output. Uses each phase's
 * `durationWeeksMin` (the conservative default) — extending a phase because
 * an athlete needs more time is a future check-in feature, not something
 * this function guesses at up front.
 */
export function generateRecoveryProgram(
  metricKey: string,
  phases: RecoveryPhase[],
  suggestionId: string,
  startDate: string,
): RecoverySession[] {
  const sessions: RecoverySession[] = [];
  let dayCursor = 0;

  for (const phase of phases) {
    const offsets = spreadDayOffsets(phase.daysPerWeek);
    for (let week = 0; week < phase.durationWeeksMin; week++) {
      for (const offset of offsets) {
        sessions.push({
          title: `${phase.name} — ${metricKey}`,
          eventType: 'drill',
          scheduledDate: addDays(startDate, dayCursor + offset),
          details: {
            metric_key: metricKey,
            phase: phase.phase,
            phase_name: phase.name,
            week_in_phase: week + 1,
            exercises: phase.exercises.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, cue: e.cue })),
            advance_criteria: phase.advanceCriteria,
            drill_suggestion_id: suggestionId,
          },
        });
      }
      dayCursor += 7;
    }
  }
  return sessions;
}
