/**
 * Streak rule: completing anything extends it, having nothing scheduled is
 * neutral (it bridges), and leaving scheduled work undone past the end of the
 * day breaks it. Declined ('skipped') work is a decision, not a miss, so it
 * never reaches these inputs as `outstanding`.
 */
import { computeStreak, classifyDay, type TrainingDay } from '../streak.js';

const day = (date: string, completed: number, outstanding = 0): TrainingDay => ({
  date,
  completed,
  outstanding,
});

describe('classifyDay', () => {
  it('counts any completion as active', () => {
    expect(classifyDay(day('2026-03-02', 1, 2), true)).toBe('active');
  });

  it('treats a day with no events as neutral', () => {
    expect(classifyDay(undefined, true)).toBe('neutral');
  });

  it('only calls undone work a miss once the day is past', () => {
    expect(classifyDay(day('2026-03-02', 0, 1), true)).toBe('missed');
    expect(classifyDay(day('2026-03-02', 0, 1), false)).toBe('neutral');
  });
});

describe('computeStreak', () => {
  it('counts consecutive completed days up to today', () => {
    const days = [day('2026-03-01', 1), day('2026-03-02', 1), day('2026-03-03', 1)];
    expect(computeStreak(days, '2026-03-03').current).toBe(3);
  });

  it('bridges a day with nothing scheduled instead of breaking', () => {
    // Mar 2 has no row at all — a true rest day the plan never filled.
    const days = [day('2026-03-01', 1), day('2026-03-03', 1)];
    const { current } = computeStreak(days, '2026-03-03');
    expect(current).toBe(3); // Mar 1 active + Mar 2 bridged + Mar 3 active
  });

  it('breaks on a past day whose scheduled work was never completed', () => {
    const days = [day('2026-03-01', 1), day('2026-03-02', 0, 2), day('2026-03-03', 1)];
    expect(computeStreak(days, '2026-03-03').current).toBe(1);
  });

  it('does not break on work still outstanding today', () => {
    const days = [day('2026-03-01', 1), day('2026-03-02', 1), day('2026-03-03', 0, 2)];
    const summary = computeStreak(days, '2026-03-03');
    expect(summary.current).toBe(2);
    expect(summary.atRiskToday).toBe(true);
  });

  it('is not at risk once today has a completion', () => {
    const days = [day('2026-03-03', 1, 1)];
    expect(computeStreak(days, '2026-03-03').atRiskToday).toBe(false);
  });

  it('reports the longest run across the whole history', () => {
    const days = [
      day('2026-03-01', 1),
      day('2026-03-02', 1),
      day('2026-03-03', 1),
      day('2026-03-04', 0, 1), // miss — breaks the 3-day run
      day('2026-03-05', 1),
    ];
    const summary = computeStreak(days, '2026-03-05');
    expect(summary.longest).toBe(3);
    expect(summary.current).toBe(1);
  });

  it('returns an empty summary for an athlete with no events', () => {
    expect(computeStreak([], '2026-03-03')).toEqual({
      current: 0,
      longest: 0,
      lastActiveDate: null,
      activeDates: [],
      streakStart: null,
      streakEnd: null,
      atRiskToday: false,
    });
  });

  it('spans the live run from its first active day to its last', () => {
    // Mar 2 is bridged, so the calendar draws Mar 1 -> Mar 3 as one bar.
    const days = [day('2026-03-01', 1), day('2026-03-03', 1)];
    const summary = computeStreak(days, '2026-03-04');
    expect(summary.streakStart).toBe('2026-03-01');
    expect(summary.streakEnd).toBe('2026-03-03');
  });

  it('reports every active date for the calendar run highlights', () => {
    const days = [day('2026-03-01', 1), day('2026-03-02', 0, 1), day('2026-03-03', 2)];
    const summary = computeStreak(days, '2026-03-03');
    expect(summary.activeDates).toEqual(['2026-03-01', '2026-03-03']);
    expect(summary.lastActiveDate).toBe('2026-03-03');
  });

  it('keeps yesterday’s streak alive on a fresh day with nothing done yet', () => {
    const days = [day('2026-03-01', 1), day('2026-03-02', 1)];
    // Athlete opens the app on the 3rd before training. Nothing scheduled yet.
    expect(computeStreak(days, '2026-03-03').current).toBe(2);
  });

  it('does not walk back forever before the first recorded day', () => {
    const days = [day('2026-03-03', 1)];
    expect(computeStreak(days, '2026-03-03').current).toBe(1);
  });
});
