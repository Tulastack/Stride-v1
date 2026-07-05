import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, ActivityIndicator } from 'react-native';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, CheckCircle2, Circle } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';

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

function getWeekDates(offset: number): Date[] {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_TYPE_COLORS: Record<string, string> = {
  drill: '#4F46E5',
  workout: '#059669',
  competition: '#DC2626',
  rest: '#9CA3AF',
};

export default function CalendarScreen() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));

  const weekDates = getWeekDates(weekOffset);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = formatDate(weekDates[0]);
      const endDate = formatDate(weekDates[6]);
      const data = await strideApi.listEvents(startDate, endDate);
      setEvents(data || []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [weekOffset]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <CalendarIcon color="#000000" size={24} />
          <Text style={styles.title}>TRAINING PLAN</Text>
        </View>

        {/* Week navigation */}
        <View style={styles.weekNav}>
          <Pressable onPress={() => setWeekOffset((w) => w - 1)} hitSlop={12}>
            <ChevronLeft color="#000000" size={24} />
          </Pressable>
          <Text style={styles.weekLabel}>
            {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} —{' '}
            {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
          <Pressable onPress={() => setWeekOffset((w) => w + 1)} hitSlop={12}>
            <ChevronRight color="#000000" size={24} />
          </Pressable>
        </View>

        {/* Day selector */}
        <View style={styles.dayRow}>
          {weekDates.map((date, i) => {
            const dateStr = formatDate(date);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === formatDate(new Date());
            const hasEvents = events.some((e) => e.scheduled_date === dateStr);
            return (
              <Pressable
                key={dateStr}
                style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                onPress={() => setSelectedDate(dateStr)}
              >
                <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>
                  {DAY_NAMES[i]}
                </Text>
                <Text style={[styles.dayNumber, isSelected && styles.dayTextSelected, isToday && styles.dayToday]}>
                  {date.getDate()}
                </Text>
                {hasEvents && <View style={[styles.dot, isSelected && styles.dotSelected]} />}
              </Pressable>
            );
          })}
        </View>

        {/* Events for selected day */}
        {loading ? (
          <ActivityIndicator size="large" color="#000000" style={styles.loader} />
        ) : dayEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Rest Day</Text>
            <Text style={styles.emptySubtitle}>No training scheduled. Recovery is progress.</Text>
          </View>
        ) : (
          <View style={styles.eventList}>
            {dayEvents.map((event) => (
              <Pressable
                key={event.id}
                style={styles.eventCard}
                onPress={() => toggleComplete(event)}
              >
                <View style={styles.eventLeft}>
                  {event.status === 'completed' ? (
                    <CheckCircle2 color="#059669" size={22} />
                  ) : (
                    <Circle color="#9CA3AF" size={22} />
                  )}
                  <View style={styles.eventInfo}>
                    <Text style={[styles.eventTitle, event.status === 'completed' && styles.eventDone]}>
                      {event.title}
                    </Text>
                    {event.details?.volume && (
                      <Text style={styles.eventVolume}>{event.details.volume}</Text>
                    )}
                    {event.details?.cue && (
                      <Text style={styles.eventCue}>💡 {event.details.cue}</Text>
                    )}
                  </View>
                </View>
                <View style={[styles.eventBadge, { backgroundColor: EVENT_TYPE_COLORS[event.event_type] || '#9CA3AF' }]}>
                  <Text style={styles.eventBadgeText}>{event.event_type.toUpperCase()}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: '#000000' },
  title: { fontSize: 28, fontWeight: '900', color: '#000000', letterSpacing: -1 },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  weekLabel: { fontSize: 14, fontWeight: '700', color: '#000000' },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  dayCell: { alignItems: 'center', padding: 8, borderRadius: 8, minWidth: 42 },
  dayCellSelected: { backgroundColor: '#000000' },
  dayName: { fontSize: 11, fontWeight: '700', color: '#666666', marginBottom: 4 },
  dayNumber: { fontSize: 16, fontWeight: '800', color: '#000000' },
  dayTextSelected: { color: '#FFFFFF' },
  dayToday: { textDecorationLine: 'underline' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#4F46E5', marginTop: 4 },
  dotSelected: { backgroundColor: '#FFFFFF' },
  loader: { marginTop: 40 },
  emptyState: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: '#000000' },
  emptySubtitle: { fontSize: 14, color: '#666666' },
  eventList: { gap: 12 },
  eventCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderWidth: 2, borderColor: '#000000', backgroundColor: '#FFFFFF' },
  eventLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  eventInfo: { flex: 1, gap: 4 },
  eventTitle: { fontSize: 15, fontWeight: '800', color: '#000000' },
  eventDone: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  eventVolume: { fontSize: 13, fontWeight: '600', color: '#333333' },
  eventCue: { fontSize: 12, color: '#666666', fontStyle: 'italic' },
  eventBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  eventBadgeText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
});
