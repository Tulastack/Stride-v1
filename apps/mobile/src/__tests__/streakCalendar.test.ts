/**
 * Grid maths behind the calendar: month layout, the continuous run bar, and
 * which days still show a "something is waiting for you" dot.
 */
import { buildWeeks, streakRuns, dotColorFor } from '../components/plan/StreakCalendar';
import { EVENT_TYPE_COLORS, type CalendarEvent } from '../lib/planCards';

const event = (over: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
  title: 'Wall drive',
  event_type: 'drill',
  scheduled_date: '2026-09-01',
  status: 'scheduled',
  ...over,
});

describe('buildWeeks', () => {
  it('pads the month out to whole weeks', () => {
    // September 2026 starts on a Tuesday and has 30 days.
    const weeks = buildWeeks(2026, 8);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]!.day).toBeNull(); // Sunday leading blank
    expect(weeks[0]![2]!.day).toBe(1); // Tuesday the 1st
    expect(weeks.flat().filter((c) => c.day !== null)).toHaveLength(30);
  });

  it('keys each cell with its local date', () => {
    const weeks = buildWeeks(2026, 8);
    expect(weeks[0]![2]!.date).toBe('2026-09-01');
  });
});

describe('streakRuns', () => {
  const week = buildWeeks(2026, 8)[1]!; // Sep 6 (Sun) .. Sep 12 (Sat)

  it('spans a run across the days it covers', () => {
    expect(streakRuns(week, '2026-09-07', '2026-09-10')).toEqual([{ start: 1, length: 4 }]);
  });

  it('returns nothing when there is no live streak', () => {
    expect(streakRuns(week, null, null)).toEqual([]);
  });

  it('clips a run that starts before the week to the part inside it', () => {
    expect(streakRuns(week, '2026-09-01', '2026-09-08')).toEqual([{ start: 0, length: 3 }]);
  });

  it('runs to the row edge when the streak continues past it', () => {
    expect(streakRuns(week, '2026-09-10', '2026-09-20')).toEqual([{ start: 4, length: 3 }]);
  });

  it('ignores a week the streak does not touch', () => {
    expect(streakRuns(week, '2026-09-20', '2026-09-25')).toEqual([]);
  });
});

describe('dotColorFor', () => {
  it('shows nothing for a day with no events', () => {
    expect(dotColorFor(undefined)).toBeNull();
    expect(dotColorFor([])).toBeNull();
  });

  it('shows nothing once everything on the day is done', () => {
    expect(dotColorFor([event({ id: 'a', status: 'completed' })])).toBeNull();
  });

  it('shows nothing for a day the athlete declined', () => {
    // A dropped day has nothing waiting on it, so it must not still nag.
    expect(dotColorFor([event({ id: 'a', status: 'skipped' })])).toBeNull();
  });

  it('takes its colour from the highest-priority outstanding event', () => {
    expect(
      dotColorFor([
        event({ id: 'a', event_type: 'rest' }),
        event({ id: 'b', event_type: 'competition' }),
      ]),
    ).toBe(EVENT_TYPE_COLORS.competition);
  });

  it('ignores completed events when picking the colour', () => {
    expect(
      dotColorFor([
        event({ id: 'a', event_type: 'competition', status: 'completed' }),
        event({ id: 'b', event_type: 'workout' }),
      ]),
    ).toBe(EVENT_TYPE_COLORS.workout);
  });
});
