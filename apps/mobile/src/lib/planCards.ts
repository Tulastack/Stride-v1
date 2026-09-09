// Shape of the Plan tab's data: the calendar event type shared across the
// screen and its components, plus the pure grouping that turns a flat list of
// newly-scheduled events into one card per training day.
//
// Kept free of React so the grouping rules can be unit-tested directly.
import { weekdayLabel, shortDateLabel, fromDateKey, monthLabel } from './dates';

export type EventType =
  | 'workout'
  | 'rest'
  | 'competition'
  | 'drill'
  | 'hydration'
  | 'recovery'
  | 'cross_training';

export type EventSource = 'manual' | 'coach' | 'analysis';

export interface CalendarEvent {
  id: string;
  title: string;
  event_type: EventType;
  scheduled_date: string;
  status: 'scheduled' | 'completed' | 'skipped' | 'modified';
  source?: EventSource;
  revealed_at?: string | null;
  details?: {
    sets?: number;
    reps?: number;
    volume?: string;
    cue?: string;
    drill_key?: string;
    why?: string;
    cues?: string[];
  };
}

// One accent per event type, used by the dots, the card edge, and the badges so
// a colour means the same thing everywhere on the tab.
export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  drill: '#CDA84E',
  workout: '#2E8F63',
  competition: '#C1432B',
  rest: '#79766A',
  hydration: '#3B82F6',
  recovery: '#EC4899',
  cross_training: '#0EA5E9',
};

// Which type gives a mixed day its identity. Competition outranks everything;
// rest only wins a day that holds nothing else.
const FOCUS_PRIORITY: EventType[] = [
  'competition',
  'workout',
  'drill',
  'cross_training',
  'recovery',
  'hydration',
  'rest',
];

const FOCUS_LABELS: Record<EventType, string> = {
  competition: 'Race day',
  workout: 'Workout',
  drill: 'Form work',
  cross_training: 'Cross-training',
  recovery: 'Recovery',
  hydration: 'Hydration',
  rest: 'Rest day',
};

export interface PlanDayCard {
  /** YYYY-MM-DD, also the card's stable React key. */
  date: string;
  weekday: string;
  /** Day of month, set as the card's headline numeral. */
  dayNumber: number;
  month: string;
  dateLabel: string;
  /** Headline for the card front. */
  focus: string;
  /** Drives the card's accent colour. */
  focusType: EventType;
  events: CalendarEvent[];
  eventIds: string[];
}

export function dominantType(events: CalendarEvent[]): EventType {
  for (const t of FOCUS_PRIORITY) {
    if (events.some((e) => e.event_type === t)) return t;
  }
  return 'workout';
}

/**
 * A day with one distinct session is named after it ("Wall drive"); a mixed day
 * falls back to its dominant category ("Form work"). Keeps the card front to a
 * single honest line instead of a truncated list.
 */
export function focusLabel(events: CalendarEvent[]): string {
  const titles = new Set(events.map((e) => e.title.trim()).filter(Boolean));
  if (titles.size === 1) return [...titles][0]!;
  return FOCUS_LABELS[dominantType(events)];
}

/** One card per day, chronological. Days with no events produce no card. */
export function groupIntoDayCards(events: CalendarEvent[]): PlanDayCard[] {
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const bucket = byDate.get(e.scheduled_date);
    if (bucket) bucket.push(e);
    else byDate.set(e.scheduled_date, [e]);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, dayEvents]) => ({
      date,
      weekday: weekdayLabel(date),
      dayNumber: fromDateKey(date).getDate(),
      month: monthLabel(date),
      dateLabel: shortDateLabel(date),
      focus: focusLabel(dayEvents),
      focusType: dominantType(dayEvents),
      events: dayEvents,
      eventIds: dayEvents.map((e) => e.id),
    }));
}

/** "3 sets x 10" / "20min tempo", whichever the event actually carries. */
export function volumeLabel(event: CalendarEvent): string | null {
  const d = event.details;
  if (!d) return null;
  if (d.sets && d.reps) return `${d.sets} × ${d.reps}`;
  if (d.volume) return d.volume;
  return null;
}

/**
 * What an empty day panel should actually say. "Rest Day" was shown whenever
 * there was nothing left to tick off, which meant finishing a hard session
 * congratulated the athlete by calling it a rest day. Rest is a thing the plan
 * prescribes, not a thing you fall into by working.
 */
export type DayStateKind = 'rest' | 'done' | 'clear';

export interface DayPanelState {
  kind: DayStateKind;
  title: string;
  subtitle: string;
}

export function dayPanelState(events: CalendarEvent[]): DayPanelState {
  const outstanding = events.filter((e) => e.status !== 'completed' && e.status !== 'skipped');
  const completed = events.filter((e) => e.status === 'completed');
  const restOnly = events.length > 0 && events.every((e) => e.event_type === 'rest');

  // Nothing on the day at all, or nothing but prescribed rest: a real rest day.
  if (events.length === 0 || restOnly) {
    return {
      kind: 'rest',
      title: 'Rest Day',
      subtitle: 'No training scheduled. Recovery is progress.',
    };
  }

  if (completed.length > 0) {
    return {
      kind: 'done',
      title: 'Workouts Completed!',
      subtitle:
        outstanding.length > 0
          ? 'Nice work. The rest of the day is still open.'
          : "Everything on today's plan is done.",
    };
  }

  // Everything that was scheduled got dropped. Not rest, not earned either.
  return {
    kind: 'clear',
    title: 'Nothing left today',
    subtitle: 'This day was cleared.',
  };
}
