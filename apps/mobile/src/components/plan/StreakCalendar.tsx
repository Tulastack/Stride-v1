import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Check, Flame, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { type Palette, type as typo, radius } from '../../theme';
import { IconButton } from '../../ui';
import { toDateKey, fromDateKey } from '../../lib/dates';
import { EVENT_TYPE_COLORS, type CalendarEvent, type EventType } from '../../lib/planCards';

const DOT_PRIORITY: EventType[] = ['competition', 'drill', 'workout', 'cross_training', 'recovery', 'hydration', 'rest'];
interface Cell { day: number | null; date: string | null }
export interface Run { start: number; length: number; openStart: boolean; openEnd: boolean }
export interface StreakCalendarProps {
  year: number; month: number; selectedDate: string;
  eventsByDate: Map<string, CalendarEvent[]>; activeDates: Set<string>;
  streakStart: string | null; streakEnd: string | null; colors: Palette;
  onSelectDate: (date: string) => void; onPrevMonth: () => void; onNextMonth: () => void; bounceKey?: number;
}

export function StreakDateRow({ cells, selectedDate, eventsByDate, activeDates, streakStart, streakEnd, colors, onSelectDate }: Pick<StreakCalendarProps, 'selectedDate' | 'eventsByDate' | 'activeDates' | 'streakStart' | 'streakEnd' | 'colors' | 'onSelectDate'> & { cells: Cell[] }) {
  const runs = streakRuns(cells, streakStart, streakEnd);
  return <View style={{ flexDirection: 'row', minHeight: 56 }}>
    {runs.map((run) => {
      const leading = run.openStart ? 0 : 0.12;
      const trailing = run.openEnd ? 0 : 0.12;
      return <View key={run.start} pointerEvents="none" testID={`streak-ribbon-${cells[run.start].date}`} style={{ position: 'absolute', top: 5, height: 36, left: `${(run.start + leading) / 7 * 100}%`, width: `${(run.length - leading - trailing) / 7 * 100}%`, backgroundColor: colors.champagne, borderTopLeftRadius: run.openStart ? 0 : radius.pill, borderBottomLeftRadius: run.openStart ? 0 : radius.pill, borderTopRightRadius: run.openEnd ? 0 : radius.pill, borderBottomRightRadius: run.openEnd ? 0 : radius.pill }} />;
    })}
    {cells.map((cell, position) => {
      if (!cell.date) return <View key={position} style={{ flex: 1 }} />;
      const date = cell.date;
      const selected = selectedDate === date;
      const active = activeDates.has(date);
      const pending = !!dotColorFor(eventsByDate.get(date));
      const inStreak = !!streakStart && !!streakEnd && date >= streakStart && date <= streakEnd;
      const label = fromDateKey(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return <Pressable key={date} testID={`calendar-date-${date}`} accessibilityRole="button" accessibilityLabel={`${label}${active ? ', completed training' : ''}${inStreak ? ', current streak' : ''}${pending ? ', session scheduled' : ''}`} accessibilityState={{ selected }} onPress={() => onSelectDate(date)} style={{ flex: 1, minWidth: 44, minHeight: 56, alignItems: 'center', gap: 3, paddingTop: 5 }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.accent : colors.transparent }}>
          <Text style={[typo.bodyMedium, { color: selected ? colors.accentText : inStreak ? colors.goldInk : colors.text, fontVariant: ['tabular-nums'] }]}>{cell.day}</Text>
        </View>
        {active ? <Check size={11} strokeWidth={2} color={colors.success} /> : <View style={{ width: 4, height: 4, marginTop: 3, borderRadius: radius.pill, backgroundColor: pending ? colors.goldInk : colors.transparent }} />}
      </Pressable>;
    })}
  </View>;
}

export function StreakSummary({ current, longest, atRiskToday, colors }: { current: number; longest: number; atRiskToday: boolean; colors: Palette }) {
  return <View testID="calendar-streak-summary" style={{ borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 8, paddingTop: 14, gap: 5 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Flame size={18} color={colors.goldInk} strokeWidth={1.6} />
      <Text style={[typo.bodyMedium, { color: colors.text, flexGrow: 1 }]}>{current ? `${current}-day streak` : 'A fresh start.'}</Text>
      <Text style={[typo.caption, { color: colors.muted }]}>Best {longest} {longest === 1 ? 'day' : 'days'}</Text>
    </View>
    <Text style={[typo.caption, { color: colors.muted }]}>{atRiskToday ? 'Today is still open. Follow your plan to keep it going.' : current ? 'Your current streak connects in gold. Checks mark completed days.' : 'Complete a planned session to start connecting your days.'}</Text>
  </View>;
}

export function StreakCalendar({ year, month, colors, onPrevMonth, onNextMonth, ...dates }: StreakCalendarProps) {
  const weeks = buildWeeks(year, month);
  return <View testID="streak-calendar" style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <IconButton label="Previous month" onPress={onPrevMonth}><ChevronLeft size={20} color={colors.muted} /></IconButton>
      <Text style={[typo.bodyMedium, { color: colors.text }]}>{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
      <IconButton label="Next month" onPress={onNextMonth}><ChevronRight size={20} color={colors.muted} /></IconButton>
    </View>
    <View style={{ flexDirection: 'row' }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <Text key={index} style={[typo.tiny, { flex: 1, textAlign: 'center', color: colors.muted }]}>{label}</Text>)}</View>
    {weeks.map((week, index) => <StreakDateRow key={index} {...dates} colors={colors} cells={week} />)}
  </View>;
}
export function buildWeeks(year: number, month: number): Cell[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Cell[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, date: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: toDateKey(new Date(year, month, d)) });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null });

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Maximal spans within one week row that fall inside the streak range. A run
 * crossing a week boundary naturally becomes one bar per row, which is what the
 * grid can actually draw.
 *
 * `openStart` / `openEnd` say the streak carries on past that edge of the row.
 * The bar is drawn square there so the ribbon looks continuous across the wrap,
 * and rounded only where the run truly begins or is cut off.
 */
export function streakRuns(
  week: Cell[],
  streakStart: string | null,
  streakEnd: string | null,
): Run[] {
  if (!streakStart || !streakEnd) return [];
  const runs: Run[] = [];
  let start = -1;

  const close = (end: number) => {
    const firstDate = week[start]!.date!;
    const lastDate = week[end - 1]!.date!;
    runs.push({
      start,
      length: end - start,
      openStart: firstDate > streakStart,
      openEnd: lastDate < streakEnd,
    });
  };

  for (let i = 0; i < week.length; i++) {
    const date = week[i]!.date;
    const inRange = !!date && date >= streakStart && date <= streakEnd;
    if (inRange && start === -1) start = i;
    if (!inRange && start !== -1) {
      close(i);
      start = -1;
    }
  }
  if (start !== -1) close(week.length);
  return runs;
}

/** Colour for a day's dot, or null when nothing is outstanding on it. */
export function dotColorFor(events: CalendarEvent[] | undefined): string | null {
  if (!events?.length) return null;
  // Completed and declined days have nothing left to do, so they get no dot,
  // the dot means "something is still waiting for you".
  const outstanding = events.filter((e) => e.status !== 'completed' && e.status !== 'skipped');
  if (!outstanding.length) return null;
  for (const t of DOT_PRIORITY) {
    if (outstanding.some((e) => e.event_type === t)) return EVENT_TYPE_COLORS[t];
  }
  return EVENT_TYPE_COLORS.rest;
}
