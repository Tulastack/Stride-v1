/**
 * Streak rule: completing anything extends it, having nothing scheduled is
 * neutral (it bridges), and leaving scheduled work undone past the end of the
 * day breaks it. Declined ('skipped') work is a decision, not a miss, so it
 * never reaches these inputs as `outstanding`.
 */
import { computeStreak, classifyDay, type TrainingDay } from '../streak.js';

/** A day trained on the day itself: every completion counted toward the run. */
const day = (date: string, completed: number, outstanding = 0): TrainingDay => ({
  date,
  completed,
  banked: completed,
  outstanding,
});

/** A day ticked off after it ended. Done on the calendar, too late for the run. */
const backfilled = (date: string, completed: number, outstanding = 0): TrainingDay => ({
  date,
  completed,
  banked: 0,
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

  it('counts a past day that was only ticked off later as missed', () => {
    expect(classifyDay(backfilled('2026-03-02', 2), true)).toBe('missed');
  });

  it('treats an undated completion as banked, so old rows keep their streak', () => {
    expect(classifyDay({ date: '2026-03-02', completed: 1, banked: 1, outstanding: 0 }, true)).toBe('active');
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

  it('does not rebuild a broken run when a missed day is ticked off later', () => {
    // Mar 2 was ghosted and later back-filled. The calendar shows it done; the
    // streak still starts again at Mar 3.
    const days = [day('2026-03-01', 1), backfilled('2026-03-02', 2), day('2026-03-03', 1)];
    const summary = computeStreak(days, '2026-03-03');
    expect(summary.current).toBe(1);
    // ...but the day is still reported as active for the grid.
    expect(summary.activeDates).toContain('2026-03-02');
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
