import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, ActivityIndicator, Animated } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, CheckCircle2, Circle } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, iconStroke } from '../../src/theme';
import { EventDetailModal } from '../../src/components/EventDetailModal';

type CalendarEvent = {
  id: string;
  title: string;
  event_type: 'workout' | 'rest' | 'competition' | 'drill' | 'hydration' | 'recovery' | 'cross_training';
  scheduled_date: string;
  status: 'scheduled' | 'completed' | 'skipped';
  details?: {
    sets?: number;
    reps?: number;
    volume?: string;
    cue?: string;
    drill_key?: string;
    why?: string;
    cues?: string[];
  };
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_TYPE_COLORS: Record<string, string> = {
  drill: '#CDA84E',        // gold accent
  workout: '#2E8F63',      // success green
  competition: '#C1432B',  // error red
  rest: '#79766A',         // muted
  hydration: '#3B82F6',    // blue
  recovery: '#EC4899',     // rose
  cross_training: '#0EA5E9', // teal-blue
};

// Fixed display order for grouping the day's activities by type. Workouts and
// drills come first (the coach's primary focus) — hydration/recovery/cross-
// training are things the athlete can add themselves when they want to.
const CATEGORY_ORDER: { type: CalendarEvent['event_type']; label: string }[] = [
  { type: 'workout', label: 'WORKOUTS' },
  { type: 'drill', label: 'FORM' },
  { type: 'hydration', label: 'HYDRATION' },
  { type: 'recovery', label: 'RECOVERY' },
  { type: 'cross_training', label: 'CROSS-TRAINING' },
  { type: 'rest', label: 'REST' },
  { type: 'competition', label: 'COMPETITION' },
];

const CHECK_ANIM_MS = 220;
const CHECK_HOLD_MS = 220;

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function formatDate(date: Date): string {
  // Build from LOCAL calendar fields. Using toISOString() here would convert to
  // UTC and shift the date across midnight for non-UTC timezones (an off-by-one
  // day that misaligns dots, "today", and event lookups with the DB date).
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMonthDateRange(year: number, month: number) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const [monthOffset, setMonthOffset] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const checkAnim = useRef(new Animated.Value(0)).current;

  const now = new Date();
  const viewYear = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getFullYear();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getMonth();
  const { firstDay, daysInMonth } = getMonthData(viewYear, viewMonth);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = getMonthDateRange(viewYear, viewMonth);
      const data = await strideApi.listEvents(startDate, endDate);
      setEvents(data || []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [monthOffset]);

  // Reload whenever the tab regains focus (so drills approved on the Analysis
  // screen show up here immediately) and whenever the month changes.
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  // Group events by date string
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach((e) => {
    if (!eventsByDate.has(e.scheduled_date)) eventsByDate.set(e.scheduled_date, []);
    eventsByDate.get(e.scheduled_date)!.push(e);
  });

  // Build grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  const dayEvents = events.filter((e) => e.scheduled_date === selectedDate && e.status !== 'completed');

  // Every event visible in dayEvents is always 'scheduled' (completed ones are
  // filtered out). Called from the detail modal's "Mark complete" action —
  // plays a brief checkmark pop on the underlying card before the item
  // actually leaves the list.
  const completeWithAnimation = (event: CalendarEvent) => {
    if (completingId) return; // one at a time
    setCompletingId(event.id);
    checkAnim.setValue(0);
    Animated.timing(checkAnim, { toValue: 1, duration: CHECK_ANIM_MS, useNativeDriver: true }).start();

    strideApi.updateEvent(event.id, { status: 'completed' }).catch(() => {});
    setTimeout(() => {
      setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, status: 'completed' } : e)));
      setCompletingId(null);
    }, CHECK_ANIM_MS + CHECK_HOLD_MS);
  };

  // Helper: get the date string for a given day number
  const dateForDay = (day: number): string => {
    const d = new Date(viewYear, viewMonth, day);
    return formatDate(d);
  };

  // Find primary event type for the dot color. A day where everything is
  // already completed shouldn't still read as "something to do" — only
  // outstanding events light up the dot.
  const getDotColor = (dateStr: string): string | null => {
    const dayEvts = eventsByDate.get(dateStr);
    if (!dayEvts || dayEvts.length === 0) return null;
    const outstanding = dayEvts.filter((e) => e.status !== 'completed');
    if (outstanding.length === 0) return null;
    // Priority: competition > drill > workout > cross-training > recovery > hydration > rest
    const priority = ['competition', 'drill', 'workout', 'cross_training', 'recovery', 'hydration', 'rest'];
    for (const p of priority) {
      if (outstanding.some((e) => e.event_type === p)) return EVENT_TYPE_COLORS[p];
    }
    return EVENT_TYPE_COLORS.rest;
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <CalendarIcon color={colors.accent} size={24} />
          <Text style={[styles.title, { color: colors.text }]}>Training{'\n'}Plan</Text>
        </View>

        {/* Month navigation */}
        <View style={styles.monthNav}>
          <Pressable onPress={() => setMonthOffset((o) => o - 1)} hitSlop={12}>
            <ChevronLeft color={colors.text} size={22} />
          </Pressable>
          <Text style={[styles.monthLabel, { color: colors.text }]}>{monthLabel}</Text>
          <Pressable onPress={() => setMonthOffset((o) => o + 1)} hitSlop={12}>
            <ChevronRight color={colors.text} size={22} />
          </Pressable>
        </View>

        {/* Day-of-week headers */}
        <View style={styles.dayHeaderRow}>
          {DAY_NAMES.map((d) => (
            <View key={d} style={styles.dayHeaderCell}>
              <Text style={[styles.dayHeaderText, { color: colors.muted }]}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
        <View style={styles.calendarGrid}>
          {cells.map((day, idx) => {
            if (day === null) {
              return <View key={idx} style={styles.dayCell} />;
            }
            const dateStr = dateForDay(day);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === formatDate(new Date());
            const dotColor = getDotColor(dateStr);

            return (
              <Pressable
                key={idx}
                style={styles.dayCell}
                onPress={() => setSelectedDate(dateStr)}
              >
                <View style={[styles.dayCellInner, isSelected && styles.dayCellSelected, isSelected && { borderColor: colors.accent, backgroundColor: colors.cardAlt }]}>
                  <Text
                    style={[
                      styles.dayNum,
                      { color: colors.muted },
                      isToday && [styles.dayNumToday, { color: colors.text }],
                      isSelected && [styles.dayNumSelected, { color: colors.accent }],
                    ]}
                  >
                    {day}
                  </Text>
                  {dotColor && <View style={[styles.dot, { backgroundColor: dotColor }]} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Events for selected day */}
        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={styles.loader} />
        ) : dayEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Rest Day</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>No training scheduled. Recovery is progress.</Text>
          </View>
        ) : (
          <View style={styles.eventList}>
            {CATEGORY_ORDER.map(({ type, label }) => {
              const items = dayEvents.filter((e) => e.event_type === type);
              if (!items.length) return null;
              return (
                <View key={type} style={styles.categoryGroup}>
                  <Text style={[styles.categoryLabel, { color: colors.muted }]}>{label}</Text>
                  {items.map((event) => {
                    const completing = completingId === event.id;
                    return (
                      <Pressable
                        key={event.id}
                        style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => setDetailEvent(event)}
                        disabled={completing}
                      >
                        <View style={styles.eventLeft}>
                          {completing ? (
                            <Animated.View
                              style={{
                                opacity: checkAnim,
                                transform: [{
                                  scale: checkAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.5, 1.25, 1] }),
                                }],
                              }}
                            >
                              <CheckCircle2 color={colors.success} size={22} />
                            </Animated.View>
                          ) : (
                            <Circle color={colors.muted} size={22} />
                          )}
                          <View style={styles.eventInfo}>
                            <Text style={[styles.eventTitle, { color: colors.text }]}>
                              {event.title}
                            </Text>
                            {event.details?.sets && event.details?.reps ? (
                              <Text style={[styles.eventVolume, { color: colors.muted }]}>
                                {event.details.sets} sets × {event.details.reps} reps
                              </Text>
                            ) : event.details?.volume ? (
                              <Text style={[styles.eventVolume, { color: colors.muted }]}>{event.details.volume}</Text>
                            ) : null}
                            {event.details?.cue && (
                              <Text style={[styles.eventCue, { color: colors.muted }]}>{event.details.cue}</Text>
                            )}
                          </View>
                        </View>
                        <View style={[styles.eventBadge, { backgroundColor: EVENT_TYPE_COLORS[event.event_type] || '#353A44' }]}>
                          <Text style={styles.eventBadgeText}>{event.event_type.replace(/_/g, ' ').toUpperCase()}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <EventDetailModal
        event={detailEvent}
        colors={colors}
        onClose={() => setDetailEvent(null)}
        onComplete={(event) => {
          setDetailEvent(null);
          completeWithAnimation(event as CalendarEvent);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: space.xl, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl, paddingBottom: space.lg, borderBottomWidth: 1 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1, lineHeight: 38 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingHorizontal: 4 },
  monthLabel: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  dayHeaderRow: { flexDirection: 'row', marginBottom: space.sm },
  dayHeaderCell: { flex: 1, alignItems: 'center' },
  dayHeaderText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.xl },
  dayCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCellInner: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: radius.sm, gap: 2 },
  dayCellSelected: { borderWidth: 1.5 },
  dayNum: { fontSize: 14, fontWeight: '600' },
  dayNumToday: { fontWeight: '900' },
  dayNumSelected: { fontWeight: '800' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  loader: { marginTop: 40 },
  emptyState: { alignItems: 'center', marginTop: 40, gap: space.sm },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  emptySubtitle: { fontSize: 14 },
  eventList: { gap: space.lg },
  categoryGroup: { gap: space.md },
  categoryLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  eventCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  eventLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, flex: 1 },
  eventInfo: { flex: 1, gap: 4 },
  eventTitle: { fontSize: 15, fontWeight: '800' },
  eventDone: { textDecorationLine: 'line-through' },
  eventVolume: { fontSize: 13, fontWeight: '600' },
  eventCue: { fontSize: 12, fontStyle: 'italic' },
  eventBadge: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: 4 },
  eventBadgeText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },
});
