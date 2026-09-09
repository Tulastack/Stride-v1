// The month grid. Two things it does that the old one did not: it draws the
// live streak as one continuous bar across the days it spans (bridged rest days
// included, which is why the run is a range rather than a set of dots), and it
// bounces on demand so the card fold has something to land on.
//
// The run is drawn as a single piece of glass laid over the days: a translucent
// accent fill, a brighter hairline round it, and a highlight along the top. It
// expands from its own start edge when it appears, the way a drop spreads. Ends
// are only rounded where the streak actually begins and ends; where it carries
// on into the next week the edge is cut square, so the two rows read as one
// ribbon wrapping rather than two separate pills.
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

/** One row's slice of the live streak, and how its two ends should be drawn. */
export interface Run {
  /** Column the slice starts at, 0-6. */
  start: number;
  /** How many columns it covers. */
  length: number;
  /** The streak began before this row, so the left edge is cut square. */
  openStart: boolean;
  /** The streak carries on after this row, so the right edge is cut square. */
  openEnd: boolean;
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
                <RunGlass key={`${wi}-${run.start}`} run={run} colors={colors} />
              ))}

              {week.map((cell, ci) => {
                if (!cell.date) return <View key={ci} style={styles.dayCell} />;

                const inRun = runs.some((r) => ci >= r.start && ci < r.start + r.length);
                const isActive = activeDates.has(cell.date);
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === today;
                const dot = dotColorFor(eventsByDate.get(cell.date));

                // Inside the run the number sits on translucent glass, so it
                // keeps the accent rather than being knocked out of it.
                const numColor = inRun
                  ? colors.accent
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
                        // dim marker, past streaks stay visible. Days inside
                        // the run get nothing of their own: the glass is the
                        // marker, and a circle under it is the "bunch of
                        // separate dots" look the run exists to replace.
                        isActive && !inRun && { backgroundColor: withAlpha(colors.accent, 0.14) },
                        isSelected && [styles.daySelected, { borderColor: colors.accent }],
                      ]}
                    >
                      <Text style={[styles.dayNum, { color: numColor }, (isToday || inRun) && styles.dayNumStrong]}>
                        {cell.day}
                      </Text>
                      {dot ? (
                        <View style={[styles.dot, { backgroundColor: dot }]} />
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

/**
 * One week's slice of the live run. Grows out of its own leading edge on first
 * paint, then holds. Square where the streak continues past the row edge,
 * rounded where it genuinely starts or ends.
 */
function RunGlass({ run, colors }: { run: Run; colors: Palette }) {
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [grow]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(grow.value, [0, 0.25, 1], [0, 0.7, 1], Extrapolation.CLAMP),
    transform: [{ scaleX: interpolate(grow.value, [0, 1], [0.06, 1], Extrapolation.CLAMP) }],
  }));

  // A run that spills over the row edge is cut flat there, so the streak reads
  // as one ribbon wrapping onto the next line.
  const leftRadius = run.openStart ? 0 : radius.pill;
  const rightRadius = run.openEnd ? 0 : radius.pill;

  return (
    <Animated.View
      pointerEvents="none"
      testID="streak-run"
      style={[
        styles.runBar,
        {
          left: `${(run.start / 7) * 100}%`,
          width: `${(run.length / 7) * 100}%`,
          backgroundColor: withAlpha(colors.accent, 0.18),
          borderColor: withAlpha(colors.accent, 0.55),
          borderTopLeftRadius: leftRadius,
          borderBottomLeftRadius: leftRadius,
          borderTopRightRadius: rightRadius,
          borderBottomRightRadius: rightRadius,
          // Grows from the leading edge. Falls back to growing from the centre
          // on any runtime that ignores transformOrigin, which still reads fine.
          transformOrigin: run.openStart ? 'right center' : 'left center',
        },
        style,
      ]}
    >
      {/* The highlight is what makes it glass rather than a flat wash. */}
      <View
        style={[
          styles.runSheen,
          {
            backgroundColor: withAlpha(colors.accent, 0.16),
            borderTopLeftRadius: leftRadius,
            borderTopRightRadius: rightRadius,
          },
        ]}
      />
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
    borderWidth: 1,
    overflow: 'hidden',
  },
  // Top-half highlight. Thin, and only on the upper edge, which is where light
  // would actually catch a rounded surface.
  runSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%' },

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
