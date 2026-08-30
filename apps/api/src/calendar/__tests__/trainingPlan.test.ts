/**
 * Progressive drill programs — approving a suggestion must produce a real
 * multi-week block (fixed weekly frequency, spaced sessions, escalating
 * volume) rather than a single occurrence.
 */
import { generateDrillProgram, generateRecoveryProgram, type RecoveryPhase } from '../trainingPlan.js';

const base = {
  drillKey: 'high-knee-switch',
  drillName: 'High-knee wall switches',
  cue: 'Punch the knee up higher than normal.',
  sets: 3,
  reps: 10,
};

describe('generateDrillProgram (pure)', () => {
  it('produces a deterministic multi-week program, not a single session', () => {
    const a = generateDrillProgram(base, 'sugg-1', '2026-02-02');
    const b = generateDrillProgram(base, 'sugg-1', '2026-02-02');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
  });

  it('schedules a fixed number of sessions per week, spaced apart (no back-to-back days)', () => {
    const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02');
    // 3 weeks x 2 sessions/week
    expect(sessions).toHaveLength(6);
    for (let i = 1; i < sessions.length; i++) {
      const prevDate = new Date(sessions[i - 1].scheduledDate);
      const curDate = new Date(sessions[i].scheduledDate);
      const gapDays = (curDate.getTime() - prevDate.getTime()) / 86_400_000;
      expect(gapDays).toBeGreaterThanOrEqual(3);
    }
  });

  it('progresses volume across weeks instead of repeating the same session', () => {
    const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02');
    const week1Reps = sessions.filter((s) => s.details.week === 1).map((s) => s.details.reps);
    const week3Reps = sessions.filter((s) => s.details.week === 3).map((s) => s.details.reps);
    expect(week1Reps.every((r) => r === base.reps)).toBe(true);
    expect(week3Reps.every((r) => r > base.reps)).toBe(true);
  });

  it('tags every session with the suggestion id for idempotent re-approval', () => {
    const sessions = generateDrillProgram(base, 'sugg-42', '2026-02-02');
    expect(sessions.every((s) => s.details.drill_suggestion_id === 'sugg-42')).toBe(true);
  });

  it('carries the drill cue and key into every session', () => {
    const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02');
    expect(sessions.every((s) => s.details.cue === base.cue)).toBe(true);
    expect(sessions.every((s) => s.details.drill_key === base.drillKey)).toBe(true);
    expect(sessions.every((s) => s.eventType === 'drill')).toBe(true);
    expect(sessions.every((s) => s.title === base.drillName)).toBe(true);
  });

  describe('athlete-driven plan shape', () => {
    it('gives a beginner a shorter block than the default', () => {
      const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02', { experienceLevel: 'beginner' });
      const weeks = new Set(sessions.map((s) => s.details.week));
      expect(weeks.size).toBe(2);
    });

    it('gives an advanced athlete a longer block than the default', () => {
      const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02', { experienceLevel: 'advanced' });
      const weeks = new Set(sessions.map((s) => s.details.week));
      expect(weeks.size).toBe(4);
    });

    it('caps an injured athlete at a short, low-frequency block regardless of experience', () => {
      const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02', {
        experienceLevel: 'advanced',
        isInjured: true,
      });
      const weeks = new Set(sessions.map((s) => s.details.week));
      expect(weeks.size).toBe(2);
      expect(sessions.filter((s) => s.details.week === 1)).toHaveLength(2);
      // never progresses past a light bump when capped
      expect(sessions.every((s) => s.details.reps <= Math.round(base.reps * 1.1))).toBe(true);
    });

    it('schedules more sessions/week for a severity-3 flaw than the default', () => {
      const sessions = generateDrillProgram(base, 'sugg-1', '2026-02-02', { flawSeverity: 3 });
      expect(sessions.filter((s) => s.details.week === 1)).toHaveLength(3);
    });

    it('carries why/cues through when the drill base provides them', () => {
      const sessions = generateDrillProgram(
        { ...base, why: 'Fixes overstriding by shortening ground contact.', cues: ['Land under your hip'] },
        'sugg-1',
        '2026-02-02',
      );
      expect(sessions.every((s) => s.details.why === 'Fixes overstriding by shortening ground contact.')).toBe(true);
      expect(sessions.every((s) => s.details.cues?.[0] === 'Land under your hip')).toBe(true);
    });

    it('omitting athlete entirely resolves to the original fixed template', () => {
      const withoutAthlete = generateDrillProgram(base, 'sugg-1', '2026-02-02');
      const withEmptyAthlete = generateDrillProgram(base, 'sugg-1', '2026-02-02', {});
      expect(withEmptyAthlete).toEqual(withoutAthlete);
    });
  });
});

// ─── generateRecoveryProgram ────────────────────────────────────────────
// A 4-phase recovery arc is a different KIND of program from
// generateDrillProgram's single-drill block: an ORDERED sequence where each
// phase's exercise group entirely replaces the previous one, not a single
// exercise progressing in volume.
const stabilityPhase: RecoveryPhase = {
  phase: 1,
  name: 'Stability',
  durationWeeksMin: 1,
  durationWeeksMax: 2,
  daysPerWeek: 4,
  exercises: [
    { name: 'Isometric hip abduction', sets: 3, reps: '10-15 x 10s holds', cue: 'Gentle press, no pain', rationale: 'Entry point', sourceCitation: 'LEAP protocol' },
  ],
  advanceCriteria: 'Pain-free isometric work.',
};
const strengthPhase: RecoveryPhase = {
  phase: 2,
  name: 'Strength',
  durationWeeksMin: 2,
  durationWeeksMax: 4,
  daysPerWeek: 3,
  exercises: [
    { name: 'Band hip abduction', sets: 3, reps: '10 @ 10-RM', cue: 'Stand tall', rationale: 'RCT backbone', sourceCitation: 'Lashien et al. 2024' },
    { name: 'Single-leg bridge', sets: 3, reps: '10-15/side', cue: 'Squeeze glute', rationale: 'RCT backbone', sourceCitation: 'Lashien et al. 2024' },
  ],
  advanceCriteria: 'Clean form, 10-RM increased.',
};
const twoPhases = [stabilityPhase, strengthPhase];

describe('generateRecoveryProgram (pure)', () => {
  it('is deterministic — same inputs yield the same output', () => {
    const a = generateRecoveryProgram('pelvic_drop', twoPhases, 'sugg-1', '2026-02-02');
    const b = generateRecoveryProgram('pelvic_drop', twoPhases, 'sugg-1', '2026-02-02');
    expect(a).toEqual(b);
  });

  it('produces the right session count per phase (durationWeeksMin x daysPerWeek)', () => {
    const sessions = generateRecoveryProgram('pelvic_drop', twoPhases, 'sugg-1', '2026-02-02');
    const phase1Sessions = sessions.filter((s) => s.details.phase === 1);
    const phase2Sessions = sessions.filter((s) => s.details.phase === 2);
    expect(phase1Sessions).toHaveLength(1 * 4); // 1 week x 4 days/week
    expect(phase2Sessions).toHaveLength(2 * 3); // 2 weeks x 3 days/week
  });

  it('phases are strictly ordered — every phase-1 session is scheduled before every phase-2 session', () => {
    const sessions = generateRecoveryProgram('pelvic_drop', twoPhases, 'sugg-1', '2026-02-02');
    const lastPhase1Date = Math.max(...sessions.filter((s) => s.details.phase === 1).map((s) => new Date(s.scheduledDate).getTime()));
    const firstPhase2Date = Math.min(...sessions.filter((s) => s.details.phase === 2).map((s) => new Date(s.scheduledDate).getTime()));
    expect(firstPhase2Date).toBeGreaterThan(lastPhase1Date);
  });

  it('each session carries the exercise group for its OWN phase, not a blend', () => {
    const sessions = generateRecoveryProgram('pelvic_drop', twoPhases, 'sugg-1', '2026-02-02');
    const phase1Session = sessions.find((s) => s.details.phase === 1)!;
    const phase2Session = sessions.find((s) => s.details.phase === 2)!;
    expect(phase1Session.details.exercises.map((e) => e.name)).toEqual(['Isometric hip abduction']);
    expect(phase2Session.details.exercises.map((e) => e.name)).toEqual(['Band hip abduction', 'Single-leg bridge']);
    expect(phase1Session.details.phase_name).toBe('Stability');
    expect(phase2Session.details.phase_name).toBe('Strength');
  });

  it('tags every session with the suggestion id and advance criteria', () => {
    const sessions = generateRecoveryProgram('pelvic_drop', twoPhases, 'sugg-99', '2026-02-02');
    expect(sessions.every((s) => s.details.drill_suggestion_id === 'sugg-99')).toBe(true);
    expect(sessions.filter((s) => s.details.phase === 1).every((s) => s.details.advance_criteria === 'Pain-free isometric work.')).toBe(true);
  });

  it('spreads sessions across the week rather than clumping on consecutive days', () => {
    const sessions = generateRecoveryProgram('pelvic_drop', [strengthPhase], 'sugg-1', '2026-02-02');
    const week1 = sessions.filter((s) => s.details.week_in_phase === 1).map((s) => new Date(s.scheduledDate).getTime());
    const gaps = week1.slice(1).map((t, i) => (t - week1[i]!) / 86_400_000);
    expect(gaps.every((g) => g >= 2)).toBe(true); // 3/week over 7 days -> ~2-3 day gaps, never back-to-back
  });

  it('empty phases array produces an empty program rather than throwing', () => {
    expect(generateRecoveryProgram('pelvic_drop', [], 'sugg-1', '2026-02-02')).toEqual([]);
  });
});
