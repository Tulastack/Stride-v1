import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import {
  MessageCircle, ArrowUp, Zap, Brain, Droplet, Award, CalendarPlus, CalendarCheck,
  Crosshair, Activity, Dumbbell, CalendarDays, Utensils, Sparkles, Lightbulb,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { strideApi } from '../services/api';
import { getAccessToken as getToken } from '../lib/supabase';
import { useStrideStore } from '../store/useStrideStore';
import { useTheme } from '../context/ThemeContext';
import { space, radius, iconStroke, type as typo } from '../theme';
import { parseCoachReply, detectMetricForDiagram, type CoachSection } from '../lib/parseCoachReply';
import { CoachMetricDiagram } from './CoachMetricDiagram';
import { PoseLoop } from './analysis/PoseLoop';
import { fetchAnalysisHistory } from '../lib/analysisApi';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sections?: CoachSection[];
  showCalendarCta?: boolean;
  thinking?: boolean;
}

const SUGGESTIONS = [
  { key: 'fix', text: 'What should I fix first?', Icon: Zap },
  { key: 'mental', text: 'How do I improve my mental game?', Icon: Brain },
  { key: 'hydrate', text: 'How should I hydrate?', Icon: Droplet },
  { key: 'recruit', text: 'How can I get recruited?', Icon: Award },
  { key: 'plan', text: 'Create a 2-week plan', Icon: CalendarPlus },
];

const THINKING_FALLBACK = [
  'Understanding your question',
  'Reading your latest analysis',
  'Checking form cues',
  'Drafting your coaching plan',
];

const SECTION_ICON: Record<string, typeof Crosshair> = {
  focus: Crosshair,
  form: Activity,
  drill: Dumbbell,
  plan: CalendarDays,
  fuel: Utensils,
  mind: Brain,
  tip: Lightbulb,
  metric: Sparkles,
};

function SectionCard({ section, colors }: { section: CoachSection; colors: any }) {
  if (section.type === 'metric' && !section.body && !section.bullets.length) return null;
  const Icon = SECTION_ICON[section.type] ?? Sparkles;
  const showHeader = section.type !== 'body' && !!section.title;
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {showHeader && (
        <View style={styles.sectionHeader}>
          <Icon size={14} color={colors.accent} strokeWidth={iconStroke} />
          <Text style={[typo.label, { color: colors.muted }]}>{section.title.toUpperCase()}</Text>
        </View>
      )}
      {!!section.body && (
        <Text style={[styles.sectionBody, { color: colors.text }]}>{section.body}</Text>
      )}
      {section.bullets.map((b, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={{ color: colors.accent, fontSize: 14 }}>•</Text>
          <Text style={[styles.bulletText, { color: colors.text }]}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

export function CoachChat({ analysisId }: { analysisId?: string } = {}) {
  const { colors } = useTheme();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState<string | null>(null);
  const [latestAnalysisId, setLatestAnalysisId] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const thinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const kickedOff = useRef(false);

  const effectiveAnalysisId = analysisId ?? latestAnalysisId ?? undefined;

  useEffect(() => () => { if (thinkTimer.current) clearInterval(thinkTimer.current); }, []);

  // Fallback analysis id for the pose animation when the chat wasn't opened
  // from a specific analysis — use the athlete's most recent completed one.
  useEffect(() => {
    if (analysisId) return;
    fetchAnalysisHistory()
      .then((history) => { if (history.length) setLatestAnalysisId(history[history.length - 1].id); })
      .catch(() => {});
  }, [analysisId]);

  // Opened from "Want personalized tips?" on a specific analysis — ground the
  // session in it and have the coach open with advice instead of waiting.
  useEffect(() => {
    if (!analysisId || kickedOff.current) return;
    kickedOff.current = true;
    send('Give me your insights on this analysis.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  function startThinking() {
    let i = 0;
    setThinkingLabel(THINKING_FALLBACK[0]);
    thinkTimer.current = setInterval(() => {
      i = Math.min(i + 1, THINKING_FALLBACK.length - 1);
      setThinkingLabel(THINKING_FALLBACK[i]);
    }, 1400);
  }

  function stopThinking() {
    if (thinkTimer.current) clearInterval(thinkTimer.current);
    thinkTimer.current = null;
    setThinkingLabel(null);
  }

  async function addToCalendar() {
    if (!sessionId.current) { Alert.alert('Error', 'Ask for a plan first.'); return; }
    setLoading(true);
    try {
      // Same base URL + token resolution as every other API call (see api.ts).
      const state = useStrideStore.getState();
      const token = (await getToken()) ?? state.token;
      const baseUrl = state.apiBaseUrl;
      const resp = await fetch(`${baseUrl}/coach-sessions/${sessionId.current}/add-to-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Failed');
      setMessages((m) => [...m, { role: 'assistant', content: `${result.created} workouts added.` }]);
      // Hand the athlete straight to the Plan tab, where the new days reveal
      // themselves as cards. Waiting for them to find the tab on their own
      // would break the line from "coach scheduled it" to "it's on my calendar".
      if (result.created > 0) router.push('/(tabs)/calendar');
    } catch (e: any) { Alert.alert('Error', e.message || 'Could not add to calendar.'); }
    finally { setLoading(false); }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', content }]);
    setLoading(true);
    startThinking();
    try {
      if (!sessionId.current) {
        const s = analysisId
          ? await strideApi.createCoachSession('analysis_workflow', analysisId)
          : await strideApi.createCoachSession('free_coach');
        sessionId.current = s.id;
      }
      const history = messages.filter((m) => !m.thinking).map((m) => ({ role: m.role, content: m.content }));
      const reply = await strideApi.askCoach(sessionId.current!, content, history);
      const progress = reply.progress;
      if (progress?.length) setThinkingLabel(progress[progress.length - 1]);
      const sections = parseCoachReply(reply.content);
      setMessages((m) => [...m, {
        role: 'assistant',
        content: reply.content,
        sections,
        showCalendarCta: reply.calendarRelevant === true,
      }]);
    } catch (err: any) {
      const busy = err?.status === 429;
      setMessages((m) => [...m, {
        role: 'assistant',
        content: busy
          ? "Your coach is a little busy right now — give it a few minutes and try again."
          : "Couldn't reach the coach. Check connection.",
      }]);
    } finally {
      stopThinking();
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.h1, { color: colors.text }]}>AI COACH</Text>
          <MessageCircle size={20} color={colors.accent} strokeWidth={iconStroke} />
        </View>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Ask about form, training, nutrition, recovery, recruiting</Text>
      </View>

      {messages.length === 0 ? (
        <View style={styles.chipsWrap}>
          {SUGGESTIONS.map(({ key, text, Icon }) => (
            <Pressable key={key} style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => send(text)}>
              <Icon size={15} color={colors.accent} strokeWidth={iconStroke} />
              <Text style={[styles.chipText, { color: colors.text }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent}>
          {messages.map((m, i) => (
            <View key={i} style={m.role === 'user' ? styles.rowRight : styles.rowLeft}>
              {m.role === 'user' ? (
                <View style={[styles.userBubble, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.userText, { color: colors.accentText }]}>{m.content}</Text>
                </View>
              ) : m.sections?.length ? (
                <View style={styles.assistantStack}>
                  {m.sections.filter((s) => s.type !== 'metric').map((s, j) => (
                    <SectionCard key={j} section={s} colors={colors} />
                  ))}
                  {(() => {
                    const metricKey = detectMetricForDiagram(m.sections!);
                    const showsForm = m.sections!.some((s) => s.type === 'form');
                    if (!metricKey && !showsForm) return null;
                    // Prefer the athlete's own pose data whenever a run is linked to
                    // this session — a generic stick figure only when none is.
                    if (effectiveAnalysisId) {
                      return <PoseLoop analysisId={effectiveAnalysisId} highlightMetricKey={metricKey ?? undefined} />;
                    }
                    return metricKey ? <CoachMetricDiagram metricKey={metricKey} /> : null;
                  })()}
                </View>
              ) : (
                <View style={[styles.assistantBubble, { backgroundColor: colors.cardAlt }]}>
                  <Text style={[styles.assistantText, { color: colors.text }]}>{m.content}</Text>
                </View>
              )}
              {m.showCalendarCta && m.role === 'assistant' && (
                <Pressable style={[styles.calCta, { backgroundColor: colors.accent }]} onPress={addToCalendar}>
                  <CalendarCheck size={15} color={colors.accentText} strokeWidth={2} />
                  <Text style={[styles.calCtaText, { color: colors.accentText }]}>Add to My Calendar</Text>
                </Pressable>
              )}
            </View>
          ))}
          {loading && thinkingLabel && (
            <View style={[styles.thinkChip, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
              <View style={[styles.thinkDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.thinkText, { color: colors.muted }]}>{thinkingLabel}</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={[styles.inputRow, { borderTopColor: colors.border }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          placeholder="Ask your coach..." placeholderTextColor={colors.muted}
          value={draft} onChangeText={setDraft}
          onSubmitEditing={() => send(draft)} returnKeyType="send" multiline maxLength={500}
        />
        <Pressable style={[styles.sendBtn, { backgroundColor: colors.accent }]} onPress={() => send(draft)}>
          <ArrowUp size={18} color={colors.accentText} strokeWidth={2.25} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.lg },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  h1: { fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
  subtitle: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  chipsWrap: { paddingHorizontal: space.xl, gap: space.sm, marginTop: space.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingVertical: space.md, paddingHorizontal: space.lg },
  chipText: { fontSize: 15 },
  thread: { flex: 1 },
  threadContent: { paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.md },
  rowRight: { alignItems: 'flex-end', marginBottom: space.sm },
  rowLeft: { alignItems: 'flex-start', marginBottom: space.sm, width: '100%' },
  userBubble: { borderRadius: radius.md, borderBottomRightRadius: 4, paddingVertical: space.md, paddingHorizontal: space.lg, maxWidth: '82%' },
  userText: { fontSize: 15, fontWeight: '500' },
  assistantBubble: { borderRadius: radius.md, borderBottomLeftRadius: 4, paddingVertical: space.md, paddingHorizontal: space.lg, maxWidth: '92%' },
  assistantText: { fontSize: 15, lineHeight: 21 },
  assistantStack: { width: '100%', gap: space.sm, maxWidth: '96%' },
  sectionCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: 6,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sectionBody: { fontSize: 15, lineHeight: 21 },
  bulletRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20 },
  thinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: space.xs,
  },
  thinkDot: { width: 6, height: 6, borderRadius: 3 },
  thinkText: { fontSize: 13, fontWeight: '500' },
  calCta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm, paddingVertical: space.sm, paddingHorizontal: space.md, marginTop: space.sm },
  calCtaText: { fontSize: 15, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, maxHeight: 100, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
