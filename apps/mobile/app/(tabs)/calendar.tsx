import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, ActivityIndicator } from 'react-native';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, CheckCircle2, Circle } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, iconStroke } from '../../src/theme';

type CalendarEvent = {
  id: string;
  title: string;
  event_type: 'workout' | 'rest' | 'competition' | 'drill';
  scheduled_date: string;
  status: 'scheduled' | 'completed' | 'skipped';
  details?: {
    volume?: string;
    cue?: string;
    drill_key?: string;
  };
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_TYPE_COLORS: Record<string, string> = {
  drill: '#CDA84E',    // gold accent
  workout: '#2E8F63',  // success green
  competition: '#C1432B', // error red
  rest: '#79766A',     // muted
};

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
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

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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

  const dayEvents = events.filter((e) => e.scheduled_date === selectedDate);

  const toggleComplete = async (event: CalendarEvent) => {
    const newStatus = event.status === 'completed' ? 'scheduled' : 'completed';
    try {
      await strideApi.updateEvent(event.id, { status: newStatus });
      setEvents((prev) =>
        prev.map((e) => (e.id === event.id ? { ...e, status: newStatus } : e))
      );
    } catch {
      // silently fail
    }
  };

  // Helper: get the date string for a given day number
  const dateForDay = (day: number): string => {
    const d = new Date(viewYear, viewMonth, day);
    return formatDate(d);
  };

  // Find primary event type for the dot color
  const getDotColor = (dateStr: string): string | null => {
    const dayEvts = eventsByDate.get(dateStr);
    if (!dayEvts || dayEvts.length === 0) return null;
    // Priority: competition > drill > workout > rest
    const priority = ['competition', 'drill', 'workout', 'rest'];
    for (const p of priority) {
      if (dayEvts.some((e) => e.event_type === p)) return EVENT_TYPE_COLORS[p];
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
            {dayEvents.map((event) => (
              <Pressable
                key={event.id}
                style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => toggleComplete(event)}
              >
                <View style={styles.eventLeft}>
                  {event.status === 'completed' ? (
                    <CheckCircle2 color={colors.success} size={22} />
                  ) : (
                    <Circle color={colors.muted} size={22} />
                  )}
                  <View style={styles.eventInfo}>
                    <Text style={[styles.eventTitle, { color: colors.text }, event.status === 'completed' && [styles.eventDone, { color: colors.muted }]]}>
                      {event.title}
                    </Text>
                    {event.details?.volume && (
                      <Text style={[styles.eventVolume, { color: colors.muted }]}>{event.details.volume}</Text>
                    )}
                    {event.details?.cue && (
                      <Text style={[styles.eventCue, { color: colors.muted }]}>💡 {event.details.cue}</Text>
                    )}
                  </View>
                </View>
                <View style={[styles.eventBadge, { backgroundColor: EVENT_TYPE_COLORS[event.event_type] || '#353A44' }]}>
                  <Text style={styles.eventBadgeText}>{event.event_type.toUpperCase()}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* Event type legend */}
        <View style={[styles.legendRow, { borderTopColor: colors.border }]}>
          {Object.entries(EVENT_TYPE_COLORS).map(([type, color]) => (
            <View key={type} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: color }]} />
              <Text style={[styles.legendText, { color: colors.muted }]}>{type}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
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
  eventList: { gap: space.md },
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
