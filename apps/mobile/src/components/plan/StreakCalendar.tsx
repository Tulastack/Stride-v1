// The month grid. Two things it does that the old one did not: it draws the
// live streak as one continuous bar across the days it spans (bridged rest days
// included, which is why the run is a range rather than a set of dots), and it
// bounces on demand so the card fold has something to land on.
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { Palette } from '../../theme';
import { space, radius } from '../../theme';
import { toDateKey } from '../../lib/dates';
import { EVENT_TYPE_COLORS, type CalendarEvent, type EventType } from '../../lib/planCards';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const ROW_HEIGHT = 46;

// Which outstanding event gives a day its dot. Mirrors the focus priority used
// by the cards so a day reads the same in both places.
const DOT_PRIORITY: EventType[] = [
  'competition',
  'drill',
  'workout',
  'cross_training',
  'recovery',
  'hydration',
  'rest',
];

export interface StreakCalendarProps {
  year: number;
  month: number;
  selectedDate: string;
  eventsByDate: Map<string, CalendarEvent[]>;
  /** Every day the athlete completed something, from the streak endpoint. */
  activeDates: Set<string>;
  /** Inclusive ends of the live run; null when there is no current streak. */
  streakStart: string | null;
  streakEnd: string | null;
  colors: Palette;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** Bump to make the grid bounce (the cards have just folded in). */
  bounceKey?: number;
}

interface Cell {
  day: number | null;
  date: string | null;
}

export function StreakCalendar({
  year,
  month,
  selectedDate,
  eventsByDate,
  activeDates,
  streakStart,
  streakEnd,
  colors,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  bounceKey = 0,
}: StreakCalendarProps) {
  const bounce = useSharedValue(0);
  // Month changes cross-fade rather than cutting, so the grid reads as the same
  // surface moving through time.
  const monthShift = useSharedValue(1);

  useEffect(() => {
    if (bounceKey > 0) {
      bounce.value = withSequence(
        withTiming(1, { duration: 190, easing: Easing.out(Easing.back(2.4)) }),
        withSpring(0, { damping: 9, stiffness: 150 }),
      );
    }
  }, [bounceKey, bounce]);

  useEffect(() => {
    monthShift.value = 0;
    monthShift.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [year, month, monthShift]);

  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);
  const monthLabel = useMemo(
    () => new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    [year, month],
  );
  const today = toDateKey(new Date());

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(bounce.value, [0, 1], [1, 1.045], Extrapolation.CLAMP) }],
  }));

  const gridStyle = useAnimatedStyle(() => ({
    opacity: monthShift.value,
    transform: [{ translateY: interpolate(monthShift.value, [0, 1], [8, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, cardStyle]}
      testID="streak-calendar"
    >
      <View style={styles.monthNav}>
        <Pressable onPress={onPrevMonth} hitSlop={14} accessibilityLabel="Previous month">
          <ChevronLeft color={colors.muted} size={20} strokeWidth={2.2} />
        </Pressable>
        <Text style={[styles.monthLabel, { color: colors.text }]}>{monthLabel}</Text>
        <Pressable onPress={onNextMonth} hitSlop={14} accessibilityLabel="Next month">
          <ChevronRight color={colors.muted} size={20} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((d) => (
          <View key={d} style={styles.weekdayCell}>
            <Text style={[styles.weekdayText, { color: colors.muted }]}>{d}</Text>
          </View>
        ))}
      </View>

      <Animated.View style={gridStyle}>
        {weeks.map((week, wi) => {
          const runs = streakRuns(week, streakStart, streakEnd);
          return (
            <View key={wi} style={styles.weekRow}>
              {/* Run bars sit behind the numbers so a streak reads as one
                  continuous stretch of days rather than seven separate pills. */}
              {runs.map((run) => (
                <View
                  key={`${wi}-${run.start}`}
                  pointerEvents="none"
                  style={[
                    styles.runBar,
                    {
                      left: `${(run.start / 7) * 100}%`,
                      width: `${(run.length / 7) * 100}%`,
                      backgroundColor: colors.accent,
                      borderColor: colors.accent,
                    },
                  ]}
                />
              ))}

              {week.map((cell, ci) => {
                if (!cell.date) return <View key={ci} style={styles.dayCell} />;

                const inRun = runs.some((r) => ci >= r.start && ci < r.start + r.length);
                const isActive = activeDates.has(cell.date);
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === today;
                const dot = dotColorFor(eventsByDate.get(cell.date));

                // On the bright run the number is knocked out of the accent;
                // everywhere else it keeps normal text contrast.
                const numColor = inRun
                  ? colors.accentText
                  : isActive
                    ? colors.accent
                    : isToday
                      ? colors.text
                      : colors.muted;

                return (
                  <Pressable
                    key={ci}
                    style={styles.dayCell}
                    onPress={() => onSelectDate(cell.date!)}
                    accessibilityRole="button"
                    accessibilityLabel={`${cell.date}${isActive ? ', completed' : ''}`}
                    testID={`day-${cell.date}`}
                  >
                    <View
                      style={[
                        styles.dayInner,
                        // A completed day outside the live run still earns a
                        // dim marker — past streaks stay visible.
                        isActive && !inRun && { backgroundColor: withAlpha(colors.accent, 0.16) },
                        isSelected && [styles.daySelected, { borderColor: inRun ? colors.accentText : colors.accent }],
                      ]}
                    >
                      <Text style={[styles.dayNum, { color: numColor }, (isToday || inRun) && styles.dayNumStrong]}>
                        {cell.day}
                      </Text>
                      {dot ? (
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: inRun ? colors.accentText : dot },
                          ]}
                        />
                      ) : (
                        <View style={styles.dotSpacer} />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

// ─── Pure helpers ───────────────────────────────────────────────────

/** Calendar cells for the month, padded to whole weeks. */
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
 */
export function streakRuns(
  week: Cell[],
  streakStart: string | null,
  streakEnd: string | null,
): { start: number; length: number }[] {
  if (!streakStart || !streakEnd) return [];
  const runs: { start: number; length: number }[] = [];
  let start = -1;

  for (let i = 0; i < week.length; i++) {
    const date = week[i]!.date;
    const inRange = !!date && date >= streakStart && date <= streakEnd;
    if (inRange && start === -1) start = i;
    if (!inRange && start !== -1) {
      runs.push({ start, length: i - start });
      start = -1;
    }
  }
  if (start !== -1) runs.push({ start, length: week.length - start });
  return runs;
}

/** Colour for a day's dot, or null when nothing is outstanding on it. */
export function dotColorFor(events: CalendarEvent[] | undefined): string | null {
  if (!events?.length) return null;
  // Completed and declined days have nothing left to do, so they get no dot —
  // the dot means "something is still waiting for you".
  const outstanding = events.filter((e) => e.status !== 'completed' && e.status !== 'skipped');
  if (!outstanding.length) return null;
  for (const t of DOT_PRIORITY) {
    if (outstanding.some((e) => e.event_type === t)) return EVENT_TYPE_COLORS[t];
  }
  return EVENT_TYPE_COLORS.rest;
}

/** Hex + alpha -> rgba(), so the palette stays the single source of colour. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  monthLabel: { fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  weekdayRow: { flexDirection: 'row', marginBottom: 2 },
  weekdayCell: { flex: 1, alignItems: 'center' },
  weekdayText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },

  weekRow: { flexDirection: 'row', height: ROW_HEIGHT, alignItems: 'center' },
  runBar: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },

  dayCell: { flex: 1, alignItems: 'center', justifyContent: 'center', height: ROW_HEIGHT },
  dayInner: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  daySelected: { borderWidth: 2 },
  dayNum: { fontSize: 14, fontWeight: '700' },
  dayNumStrong: { fontWeight: '900' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotSpacer: { width: 4, height: 4 },
});
