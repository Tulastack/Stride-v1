// Local-date helpers. Everything the calendar does is in the athlete's own
// timezone: toISOString() would convert to UTC and shift the date across
// midnight, which silently misaligns dots, "today", and event lookups by a day.

/** YYYY-MM-DD built from LOCAL calendar fields. Never use toISOString() here. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/** Parse a YYYY-MM-DD key back into a LOCAL midnight Date. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDaysToKey(key: string, delta: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

/** Whole days between two date keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 86_400_000;
  // Normalised to UTC midnight before subtracting so a DST boundary in the
  // athlete's timezone can't turn a 1-day gap into 0.96 and floor to 0.
  const ua = Date.UTC(fromDateKey(a).getFullYear(), fromDateKey(a).getMonth(), fromDateKey(a).getDate());
  const ub = Date.UTC(fromDateKey(b).getFullYear(), fromDateKey(b).getMonth(), fromDateKey(b).getDate());
  return Math.round((ub - ua) / MS_PER_DAY);
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

export function weekdayLabel(key: string): string {
  return WEEKDAYS[fromDateKey(key).getDay()]!;
}

/** "MAR" — the card pairs this with the day numeral. */
export function monthLabel(key: string): string {
  return MONTHS[fromDateKey(key).getMonth()]!;
}

/** "MAR 4" — short and unambiguous on a card that must stay light on text. */
export function shortDateLabel(key: string): string {
  const d = fromDateKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
