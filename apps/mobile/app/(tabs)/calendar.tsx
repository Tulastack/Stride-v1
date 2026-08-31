// Plan tab. Three things live here, in the order the athlete meets them:
//
//   1. The reveal — work the coach or the analysis engine just scheduled takes
//      the screen over as a stack of day cards, then folds into the grid.
//   2. The grid — the month, with the live streak drawn as one continuous run.
//   3. The day — whatever is scheduled for the date currently selected.
//
// Manually-added events never trigger step 1 (see calendar_events.source).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, ActivityIndicator } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius } from '../../src/theme';
import { EventDetailModal } from '../../src/components/EventDetailModal';
import { PlanCardStack } from '../../src/components/plan/PlanCardStack';
import { StreakCalendar } from '../../src/components/plan/StreakCalendar';
import { StreakBadge } from '../../src/components/plan/StreakBadge';
import { toDateKey, todayKey } from '../../src/lib/dates';
import {
  groupIntoDayCards,
  volumeLabel,
  EVENT_TYPE_COLORS,
  type CalendarEvent,
  type PlanDayCard,
} from '../../src/lib/planCards';

const CHECK_ANIM_MS = 220;
const CHECK_HOLD_MS = 220;

// Workouts and drills lead — they are the coach's focus. The rest are things
// the athlete adds for themselves.
const CATEGORY_ORDER: { type: CalendarEvent['event_type']; label: string }[] = [
  { type: 'workout', label: 'WORKOUTS' },
  { type: 'drill', label: 'FORM' },
  { type: 'hydration', label: 'HYDRATION' },
  { type: 'recovery', label: 'RECOVERY' },
  { type: 'cross_training', label: 'CROSS-TRAINING' },
  { type: 'rest', label: 'REST' },
  { type: 'competition', label: 'COMPETITION' },
];

interface StreakState {
  current: number;
  longest: number;
  activeDates: string[];
  streakStart: string | null;
  streakEnd: string | null;
  atRiskToday: boolean;
}

const EMPTY_STREAK: StreakState = {
  current: 0,
  longest: 0,
  activeDates: [],
  streakStart: null,
  streakEnd: null,
  atRiskToday: false,
};

function monthRange(year: number, month: number) {
  return {
    startDate: toDateKey(new Date(year, month, 1)),
    endDate: toDateKey(new Date(year, month + 1, 0)),
  };
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const [monthOffset, setMonthOffset] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [streak, setStreak] = useState<StreakState>(EMPTY_STREAK);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);

  // Reveal state. `cards` is non-empty only while the takeover is on screen.
  const [cards, setCards] = useState<PlanDayCard[]>([]);
  const [bounceKey, setBounceKey] = useState(0);
  const [celebrateKey, setCelebrateKey] = useState(0);
  // One reveal per focus: without this, the refetch triggered by the fold would
  // immediately re-open the stack it just closed.
  const revealInFlight = useRef(false);

  const checkAnim = useSharedValue(0);
  const dayPanel = useSharedValue(1);

  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  // ── Loading ───────────────────────────────────────────────────────

  const loadEvents = useCallback(async () => {
    const { startDate, endDate } = monthRange(viewYear, viewMonth);
    try {
      const data = await strideApi.listEvents(startDate, endDate);
      setEvents((data as CalendarEvent[]) ?? []);
    } catch {
      setEvents([]);
    }
  }, [viewYear, viewMonth]);

  const loadStreak = useCallback(async () => {
    try {
      // The athlete's local date decides when their day ends, not the server's.
      const s = await strideApi.getStreak(todayKey());
      setStreak({
        current: s.current,
        longest: s.longest,
        activeDates: s.activeDates ?? [],
        streakStart: s.streakStart ?? null,
        streakEnd: s.streakEnd ?? null,
        atRiskToday: s.atRiskToday,
      });
    } catch {
      // A streak we cannot fetch is shown as no streak rather than a stale one.
      setStreak(EMPTY_STREAK);
    }
  }, []);

  const loadReveal = useCallback(async () => {
    if (revealInFlight.current) return;
    try {
      const pending = await strideApi.listUnrevealedEvents();
      const list = (pending as CalendarEvent[]) ?? [];
      if (list.length > 0) {
        revealInFlight.current = true;
        setCards(groupIntoDayCards(list));
      }
    } catch {
      // No reveal is a fine failure mode — the plan is still in the grid.
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadEvents(), loadStreak()]);
    setLoading(false);
  }, [loadEvents, loadStreak]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      loadReveal();
    }, [refresh, loadReveal]),
  );

  // Month navigation refetches without re-triggering the reveal. The first run
  // is skipped because focus has already loaded this month — otherwise every
  // mount would fire the same request twice.
  const monthMounted = useRef(false);
  useEffect(() => {
    if (!monthMounted.current) {
      monthMounted.current = true;
      return;
    }
    loadEvents();
  }, [loadEvents]);

  // Fade the day panel when the selection changes, so switching days reads as a
  // change of content rather than a flicker.
  useEffect(() => {
    dayPanel.value = 0;
    dayPanel.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [selectedDate, dayPanel]);

  // ── Reveal handlers ───────────────────────────────────────────────

  const acceptCard = useCallback((card: PlanDayCard) => {
    strideApi.revealEvents(card.eventIds).catch(() => {});
  }, []);

  const declineCard = useCallback((card: PlanDayCard) => {
    strideApi.declineEvents(card.eventIds).catch(() => {});
  }, []);

  const undoDecline = useCallback((card: PlanDayCard) => {
    strideApi.undoDeclineEvents(card.eventIds).catch(() => {});
  }, []);

  const skipAll = useCallback(() => {
    // Sent with no ids on purpose: this clears every outstanding reveal,
    // including any that arrived while the stack was open, so a skip can never
    // leave the takeover to reappear on the next visit.
    strideApi.revealEvents().catch(() => {});
  }, []);

  const revealDone = useCallback(() => {
    setCards([]);
    revealInFlight.current = false;
    // The grid bounces as the cards land in it, and the streak celebrates.
    setBounceKey((k) => k + 1);
    setCelebrateKey((k) => k + 1);
    refresh();
  }, [refresh]);

  // ── Completion ────────────────────────────────────────────────────

  const completeWithAnimation = useCallback(
    (event: CalendarEvent) => {
      if (completingId) return; // one at a time
      setCompletingId(event.id);
      checkAnim.value = 0;
      checkAnim.value = withSequence(
        withTiming(1, { duration: CHECK_ANIM_MS, easing: Easing.out(Easing.back(2.2)) }),
        withTiming(1, { duration: CHECK_HOLD_MS }),
      );

      strideApi.updateEvent(event.id, { status: 'completed' }).catch(() => {});
      setTimeout(() => {
        setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, status: 'completed' } : e)));
        setCompletingId(null);
        // A completion can start or extend the streak, so re-derive it rather
        // than guessing locally.
        loadStreak();
      }, CHECK_ANIM_MS + CHECK_HOLD_MS);
    },
    [completingId, checkAnim, loadStreak],
  );

  // ── Derived ───────────────────────────────────────────────────────

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const bucket = map.get(e.scheduled_date);
      if (bucket) bucket.push(e);
      else map.set(e.scheduled_date, [e]);
    }
    return map;
  }, [events]);

  const activeDates = useMemo(() => new Set(streak.activeDates), [streak.activeDates]);

  const dayEvents = useMemo(
    () =>
      events.filter(
        (e) => e.scheduled_date === selectedDate && e.status !== 'completed' && e.status !== 'skipped',
      ),
    [events, selectedDate],
  );

  const checkStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, checkAnim.value * 2),
    transform: [{ scale: interpolate(checkAnim.value, [0, 0.6, 1], [0.5, 1.25, 1], Extrapolation.CLAMP) }],
  }));

  const dayPanelStyle = useAnimatedStyle(() => ({
    opacity: dayPanel.value,
    transform: [{ translateY: interpolate(dayPanel.value, [0, 1], [10, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: colors.muted }]}>TRAINING</Text>
            <Text style={[styles.title, { color: colors.text }]}>Plan</Text>
          </View>
          <StreakBadge
            value={streak.current}
            atRisk={streak.atRiskToday}
            colors={colors}
            celebrateKey={celebrateKey}
            testID="streak-badge"
          />
        </View>

        <StreakCalendar
          year={viewYear}
          month={viewMonth}
          selectedDate={selectedDate}
          eventsByDate={eventsByDate}
          activeDates={activeDates}
          streakStart={streak.streakStart}
          streakEnd={streak.streakEnd}
          colors={colors}
          onSelectDate={setSelectedDate}
          onPrevMonth={() => setMonthOffset((o) => o - 1)}
          onNextMonth={() => setMonthOffset((o) => o + 1)}
          bounceKey={bounceKey}
        />

        {streak.current > 0 ? (
          <Text style={[styles.streakLine, { color: colors.muted }]}>
            {streak.atRiskToday
              ? `${streak.current}-day streak — today is still open`
              : `${streak.current}-day streak · best ${streak.longest}`}
          </Text>
        ) : null}

        <Animated.View style={dayPanelStyle}>
          {loading ? (
            <ActivityIndicator size="large" color={colors.accent} style={styles.loader} />
          ) : dayEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Rest Day</Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                No training scheduled. Recovery is progress.
              </Text>
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
                      const volume = volumeLabel(event);
                      return (
                        <Pressable
                          key={event.id}
                          style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={() => setDetailEvent(event)}
                          disabled={completing}
                        >
                          <View style={[styles.eventEdge, { backgroundColor: EVENT_TYPE_COLORS[event.event_type] }]} />
                          <View style={styles.eventLeft}>
                            {completing ? (
                              <Animated.View style={checkStyle}>
                                <CheckCircle2 color={colors.success} size={22} />
                              </Animated.View>
                            ) : (
                              <Circle color={colors.muted} size={22} />
                            )}
                            <View style={styles.eventInfo}>
                              <Text style={[styles.eventTitle, { color: colors.text }]}>{event.title}</Text>
                              {volume ? (
                                <Text style={[styles.eventVolume, { color: colors.muted }]}>{volume}</Text>
                              ) : null}
                              {event.details?.cue ? (
                                <Text style={[styles.eventCue, { color: colors.muted }]} numberOfLines={2}>
                                  {event.details.cue}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>
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

      {cards.length > 0 ? (
        <PlanCardStack
          cards={cards}
          colors={colors}
          onAccept={acceptCard}
          onDecline={declineCard}
          onUndoDecline={undoDecline}
          onSkipAll={skipAll}
          onDone={revealDone}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: space.xl, paddingBottom: 40, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },

  streakLine: { fontSize: 12, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 },

  loader: { marginTop: 40 },
  emptyState: { alignItems: 'center', marginTop: space.xl, gap: space.sm },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  emptySubtitle: { fontSize: 14 },

  eventList: { gap: space.lg },
  categoryGroup: { gap: space.sm },
  categoryLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.lg,
    paddingLeft: space.lg + 5,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  eventEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  eventLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, flex: 1 },
  eventInfo: { flex: 1, gap: 3 },
  eventTitle: { fontSize: 15, fontWeight: '800' },
  eventVolume: { fontSize: 13, fontWeight: '700' },
  eventCue: { fontSize: 12, fontStyle: 'italic', lineHeight: 16 },
});
