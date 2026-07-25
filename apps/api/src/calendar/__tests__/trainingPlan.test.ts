/**
 * Progressive drill programs — approving a suggestion must produce a real
 * multi-week block (fixed weekly frequency, spaced sessions, escalating
 * volume) rather than a single occurrence.
 */
import { generateDrillProgram } from '../trainingPlan.js';

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
