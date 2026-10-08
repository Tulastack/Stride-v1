import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { CheckCircle2, Circle, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';
import { EventDetailModal } from '../../src/components/EventDetailModal';
import { PlanCardStack } from '../../src/components/plan/PlanCardStack';
import { StreakCalendar, StreakDateRow, StreakSummary } from '../../src/components/plan/StreakCalendar';
import { toDateKey, todayKey, fromDateKey, addDaysToKey } from '../../src/lib/dates';
import { groupIntoDayCards, volumeLabel, dayPanelState, type CalendarEvent, type PlanDayCard } from '../../src/lib/planCards';
import { Screen, ScreenHeader, SectionTitle, Button, Notice, TrackScene, IconButton } from '../../src/ui';

interface Streak { current: number; longest: number; activeDates: string[]; streakStart: string | null; streakEnd: string | null; atRiskToday: boolean }
const EMPTY_STREAK: Streak = { current: 0, longest: 0, activeDates: [], streakStart: null, streakEnd: null, atRiskToday: false };

export default function CalendarScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [monthVisible, setMonthVisible] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [streak, setStreak] = useState<Streak>(EMPTY_STREAK);
  const [streakLoaded, setStreakLoaded] = useState(false);
  const [cards, setCards] = useState<PlanDayCard[]>([]);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const revealInFlight = useRef(false);
  const completionLock = useRef(false);
  const year = monthDate.getFullYear(), month = monthDate.getMonth();
  const loadStreak = useCallback(async () => {
    const data = await strideApi.getStreak(todayKey());
    setStreak({ ...data, activeDates: data.activeDates ?? [], streakStart: data.streakStart ?? null, streakEnd: data.streakEnd ?? null });
  }, []);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([strideApi.listEvents(addDaysToKey(toDateKey(new Date(year, month, 1)), -7), addDaysToKey(toDateKey(new Date(year, month + 1, 0)), 7)), strideApi.getStreak(todayKey())]).then(([list, adherence]) => {
      if (!active) return;
      setEvents((list as CalendarEvent[]) ?? []); setStreak({ ...adherence, activeDates: adherence.activeDates ?? [], streakStart: adherence.streakStart ?? null, streakEnd: adherence.streakEnd ?? null }); setStreakLoaded(true);
    }).catch(() => { if (active) setError('Could not refresh your plan. Check your connection and try again.'); }).finally(() => { if (active) setLoading(false); });
    if (!revealInFlight.current) strideApi.listUnrevealedEvents().then((list) => {
      if (active && list?.length) { revealInFlight.current = true; setCards(groupIntoDayCards(list as CalendarEvent[])); }
    }).catch(() => {});
    return () => { active = false; };
  }, [year, month, attempt]));
  const complete = async (event: CalendarEvent) => {
    if (completionLock.current || event.scheduled_date > todayKey()) return;
    completionLock.current = true; setCompletingId(event.id); setError('');
    try {
      await strideApi.updateEvent(event.id, { status: 'completed', today: todayKey() });
      setEvents((previous) => previous.map((item) => item.id === event.id ? { ...item, status: 'completed' } : item));
      setDetail(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await loadStreak();
    } catch { setError('Could not confirm the update. Refresh the plan before trying again.'); }
    finally { completionLock.current = false; setCompletingId(null); }
  };
  const select = (date: string) => { setSelectedDate(date); const next = fromDateKey(date); if (next.getFullYear() !== year || next.getMonth() !== month) setMonthDate(next); };
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) map.set(event.scheduled_date, [...(map.get(event.scheduled_date) ?? []), event]);
    return map;
  }, [events]);
  const dayEvents = eventsByDate.get(selectedDate) ?? [];
  const panel = dayEvents.length ? dayPanelState(dayEvents) : {
    kind: 'unscheduled',
    title: events.length ? 'An open day.' : 'Your plan starts here.',
    subtitle: events.length ? 'Nothing is scheduled for this day. Follow your existing recovery guidance or ask your coach what fits.' : 'Turn your goals and sprint feedback into purposeful sessions. Nothing is scheduled until you choose to add it.',
  };
  const weekday = fromDateKey(selectedDate).getDay();
  const monday = addDaysToKey(selectedDate, -(weekday === 0 ? 6 : weekday - 1));
  const week = Array.from({ length: 7 }, (_, index) => addDaysToKey(monday, index));
  const completed = dayEvents.filter((event) => event.status === 'completed').length;
  const outstanding = dayEvents.filter((event) => event.status !== 'completed' && event.status !== 'skipped');
  return <Screen>
    <ScreenHeader logo title="Your plan." />
    {error ? <><Notice tone="error">{error}</Notice><Button label="Refresh plan" variant="secondary" onPress={() => setAttempt(attempt + 1)} /></> : null}
    <View testID="plan-calendar-surface" style={{ padding: 12, borderRadius: radius.lg, backgroundColor: colors.card }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ width: Math.max(308, Math.min(width, 640) - 72), gap: 8 }}>
          {monthVisible ? <StreakCalendar year={year} month={month} selectedDate={selectedDate} eventsByDate={eventsByDate} activeDates={new Set(streak.activeDates)} streakStart={streak.streakStart} streakEnd={streak.streakEnd} colors={colors} onSelectDate={select} onPrevMonth={() => setMonthDate(new Date(year, month - 1, 1))} onNextMonth={() => setMonthDate(new Date(year, month + 1, 1))} /> : <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <IconButton label="Previous week" onPress={() => select(addDaysToKey(selectedDate, -7))}><ChevronLeft color={colors.muted} size={18} /></IconButton>
              <Text style={[typo.bodyMedium, { color: colors.text }]}>{fromDateKey(monday).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {fromDateKey(week[6]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
              <IconButton label="Next week" onPress={() => select(addDaysToKey(selectedDate, 7))}><ChevronRight color={colors.muted} size={18} /></IconButton>
            </View>
            <View style={{ flexDirection: 'row' }}>{week.map((date) => <Text key={date} style={[typo.tiny, { flex: 1, textAlign: 'center', color: colors.muted }]}>{fromDateKey(date).toLocaleDateString('en-US', { weekday: 'narrow' })}</Text>)}</View>
            <StreakDateRow cells={week.map((date) => ({ date, day: fromDateKey(date).getDate() }))} selectedDate={selectedDate} eventsByDate={eventsByDate} activeDates={new Set(streak.activeDates)} streakStart={streak.streakStart} streakEnd={streak.streakEnd} colors={colors} onSelectDate={select} />
          </>}
        </View>
      </ScrollView>
      {streakLoaded ? <StreakSummary current={streak.current} longest={streak.longest} atRiskToday={streak.atRiskToday} colors={colors} /> : null}
      <Button label={monthVisible ? 'Close monthly calendar' : 'View monthly calendar'} variant="quiet" onPress={() => setMonthVisible(!monthVisible)} />
    </View>
    <SectionTitle aside={selectedDate !== todayKey() ? <Button label="Today" variant="quiet" onPress={() => select(todayKey())} /> : undefined}>{selectedDate === todayKey() ? 'Today' : fromDateKey(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</SectionTitle>
    {loading ? <Notice>Loading scheduled sessions…</Notice> : error && !events.length ? <Notice>Your schedule is unavailable, not necessarily empty. Reconnect to see what is planned.</Notice> : !outstanding.length ? <View testID={`day-panel-${panel.kind}`} style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.well }}><TrackScene compact /><View style={{ padding: 24, gap: 12 }}><Text style={[typo.editorial, { color: colors.wellText }]}>{panel.title}</Text><Text style={[typo.body, { color: colors.wellMuted }]}>{panel.subtitle}</Text>{!dayEvents.length ? <Button label="Build a plan with your coach" onPress={() => router.push('/(tabs)/coach')} /> : null}</View></View> : <View style={{ gap: 16 }}>
      {outstanding.map((event, index) => <Pressable key={event.id} accessibilityRole="button" testID={`session-${event.id}`} accessibilityLabel={`${event.title}. ${volumeLabel(event)}`} onPress={() => setDetail(event)} style={{ padding: space.xl, borderRadius: radius.md, backgroundColor: index === 0 ? colors.well : colors.cardAlt, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Text style={[typo.label, { color: index === 0 ? colors.accent : colors.goldInk, flex: 1 }]}>{event.event_type.replace(/_/g, ' ').toUpperCase()} / {index === 0 ? 'NEXT UP' : 'LATER'}</Text><Circle size={18} color={index === 0 ? colors.wellMuted : colors.muted} /></View>
        <Text style={[typo.h2, { color: index === 0 ? colors.wellText : colors.text }]}>{event.title}</Text><Text style={[typo.body, { color: index === 0 ? colors.wellMuted : colors.muted }]}>{volumeLabel(event)}</Text>{event.details?.cue ? <Text style={[typo.caption, { color: index === 0 ? colors.wellMuted : colors.muted }]}>{event.details.cue}</Text> : null}
      </Pressable>)}
    </View>}
    {completed ? <><SectionTitle>Completed / {completed}</SectionTitle>{dayEvents.filter((event) => event.status === 'completed').map((event) => <Pressable key={event.id} accessibilityRole="button" onPress={() => setDetail(event)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}><CheckCircle2 color={colors.success} size={18} /><Text style={[typo.body, { color: colors.muted }]}>{event.title}</Text></Pressable>)}</> : null}
    <EventDetailModal event={detail} colors={colors} today={todayKey()} onClose={() => { if (!completingId) setDetail(null); }} onComplete={(event) => complete(event as CalendarEvent)} busy={!!completingId} />
    {cards.length ? <PlanCardStack cards={cards} colors={colors} onAccept={async (card) => { await strideApi.revealEvents(card.eventIds); }} onSkipAll={async () => { await strideApi.revealEvents(); }} onDone={() => { setCards([]); revealInFlight.current = false; setAttempt(attempt + 1); }} /> : null}
  </Screen>;
}
