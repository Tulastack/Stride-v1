// Streak derivation. Pure functions over per-day training activity — no DB, no
// clock of its own (the caller passes "today" so the athlete's local date wins
// over the server's UTC date; see the local-date discipline in queries.ts).
//
// The rule, in one line: doing something extends the streak, having nothing to
// do is neutral, and ghosting scheduled work breaks it.
//
//   completed > 0                 -> ACTIVE   extends the streak
//   nothing scheduled             -> NEUTRAL  bridges (neither extends nor breaks)
//   only rest / declined work     -> NEUTRAL  rest is prescribed; a decline is a decision
//   scheduled work left undone    -> MISSED   breaks the streak, but only once the day is past
//
// Today is never counted as missed: a day still in progress cannot have been
// ghosted yet, so an athlete who opens the app at 8am keeps the streak they
// went to bed with.

export type DayState = 'active' | 'neutral' | 'missed';

export interface TrainingDay {
  /** YYYY-MM-DD */
  date: string;
  /** Events marked completed on this day. */
  completed: number;
  /** Still-scheduled, non-rest work. Excludes declined ('skipped') events. */
  outstanding: number;
}

export interface StreakSummary {
  /** Days in the streak running up to today. */
  current: number;
  /** Best run the athlete has ever put together. */
  longest: number;
  /** Most recent day with a completion, or null if there has never been one. */
  lastActiveDate: string | null;
  /** Every day that counted, ascending — drives the calendar's run highlights. */
  activeDates: string[];
  /**
   * First and last day of the run that is live right now, inclusive. The
   * calendar draws this span as one continuous bar (bridged rest days
   * included), which is why it is a range rather than a list of dates.
   * Both null when there is no current streak.
   */
  streakStart: string | null;
  streakEnd: string | null;
  /**
   * True when there is still outstanding work today, so the streak is live but
   * not yet banked. The UI uses this to show the flame as an outline rather
   * than claiming a day the athlete has not finished.
   */
  atRiskToday: boolean;
}

/** Days are compared as plain YYYY-MM-DD strings, which sort lexicographically. */
function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Constructed in UTC and read back in UTC, so this is pure string arithmetic
  // on a calendar date — no timezone can shift it across midnight.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function classifyDay(day: TrainingDay | undefined, isPast: boolean): DayState {
  if (!day) return 'neutral';
  if (day.completed > 0) return 'active';
  // Outstanding work only counts against the athlete once the day is over.
  if (day.outstanding > 0 && isPast) return 'missed';
  return 'neutral';
}

export function computeStreak(days: TrainingDay[], today: string): StreakSummary {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const activeDates = days.filter((d) => d.completed > 0).map((d) => d.date).sort();
  const lastActiveDate = activeDates.length ? activeDates[activeDates.length - 1]! : null;

  // ── Current streak: walk backwards from today until something breaks it.
  let current = 0;
  let cursor = today;
  // A neutral day only bridges when it sits *between* two active days. Walking
  // backwards, neutral days seen before the first active one are trailing — an
  // athlete opening the app before today's session has not earned today yet, so
  // those are discarded rather than banked.
  let pendingNeutral = 0;
  let started = false;
  // Ends of the live run. `streakEnd` is the newest active day in it, which is
  // not necessarily today (an athlete mid-rest-day still has a streak).
  let streakStart: string | null = null;
  let streakEnd: string | null = null;
  // Stop at the first recorded day — walking back through empty prehistory
  // would loop forever on an athlete with no events at all.
  const earliest = days.length ? days[0]!.date : today;

  while (cursor >= earliest) {
    const state = classifyDay(byDate.get(cursor), cursor < today);
    if (state === 'missed') break;
    if (state === 'active') {
      current += (started ? pendingNeutral : 0) + 1;
      pendingNeutral = 0;
      started = true;
      if (!streakEnd) streakEnd = cursor;
      streakStart = cursor;
    } else {
      pendingNeutral += 1;
    }
    cursor = addDays(cursor, -1);
  }

  // ── Longest streak: same rule, swept forward over the whole history.
  let longest = 0;
  let run = 0;
  let runNeutral = 0;
  if (days.length) {
    const last = days[days.length - 1]!.date;
    for (let d = days[0]!.date; d <= last; d = addDays(d, 1)) {
      const state = classifyDay(byDate.get(d), d < today);
      if (state === 'missed') {
        longest = Math.max(longest, run);
        run = 0;
        runNeutral = 0;
      } else if (state === 'active') {
        run += runNeutral + 1;
        runNeutral = 0;
        longest = Math.max(longest, run);
      } else if (run > 0) {
        // Trailing neutral days only count if the run resumes after them.
        runNeutral += 1;
      }
    }
    longest = Math.max(longest, run);
  }

  const todayRow = byDate.get(today);
  return {
    current,
    longest: Math.max(longest, current),
    lastActiveDate,
    activeDates,
    streakStart,
    streakEnd,
    atRiskToday: !!todayRow && todayRow.completed === 0 && todayRow.outstanding > 0,
  };
}
