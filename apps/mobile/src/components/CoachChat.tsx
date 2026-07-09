import React, { useState, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { MessageCircle, ArrowUp, Zap, Brain, Droplet, Award, CalendarPlus, CalendarCheck } from 'lucide-react-native';
import { strideApi } from '../services/api';
import { getAccessToken as getToken } from '../lib/supabase';

const colors = { bg: '#0E0F12', card: '#16181D', cardAlt: '#1E2127', border: '#353A44', text: '#ECE7DC', muted: '#8A8E97', accent: '#CDFF4F', accentText: '#0E0F12', error: '#FF5237', success: '#5BE5A0' };
const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const radius = { sm: 8, md: 12, pill: 999 };

interface Msg { role: 'user' | 'assistant'; content: string; showCalendarCta?: boolean; }

const SUGGESTIONS = [
  { key: 'fix', text: 'What should I fix first?', Icon: Zap },
  { key: 'mental', text: 'How do I improve my mental game?', Icon: Brain },
  { key: 'hydrate', text: 'How should I hydrate?', Icon: Droplet },
  { key: 'recruit', text: 'How can I get recruited?', Icon: Award },
  { key: 'plan', text: 'Create a 2-week plan', Icon: CalendarPlus },
];

function detectCalendarIntent(text: string): boolean {
  const keywords = ['calendar', 'schedule', 'plan my week', 'training plan', 'put on my calendar', 'add to calendar', 'workout plan', 'add this to your calendar', 'would you like me to add', '2-week'];
  return keywords.some((k) => text.toLowerCase().includes(k));
}

function cleanResponse(raw: string): string {
  return raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/#{1,3}\s*/g, '').replace(/`(.+?)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

export function CoachChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function addToCalendar() {
    if (!sessionId.current) { Alert.alert('Error', 'Ask for a plan first.'); return; }
    setLoading(true);
    try {
      const token = await getToken();
      const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
      const resp = await fetch(`${baseUrl}/coach-sessions/${sessionId.current}/add-to-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ history: historyPayload }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Failed');
      setMessages((m) => [...m, { role: 'assistant', content: `✅ ${result.created} workouts added to your calendar! Check the Plan tab.` }]);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not add to calendar.');
    } finally { setLoading(false); }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    setDraft('');
    const isCalendarRequest = detectCalendarIntent(content);
    setMessages((m) => [...m, { role: 'user', content }]);
    setLoading(true);
    try {
      if (!sessionId.current) {
        const session = await strideApi.createCoachSession('free_coach');
        sessionId.current = session.id;
      }
      const prompt = isCalendarRequest
        ? `${content}\n\nThe user wants workouts scheduled. After providing the plan, offer to add it to their calendar.`
        : content;
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const reply = await strideApi.askCoach(sessionId.current!, prompt, history);
      const formatted = cleanResponse(reply.content);
      setMessages((m) => [...m, { role: 'assistant', content: formatted, showCalendarCta: isCalendarRequest || detectCalendarIntent(formatted) }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry — couldn\'t reach the coach. Check connection.' }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.h1}>AI COACH</Text>
          <MessageCircle size={20} color={colors.accent} strokeWidth={1.75} />
        </View>
        <Text style={styles.subtitle}>Ask about anything — form, training, nutrition, recovery, recruiting</Text>
      </View>

      {messages.length === 0 ? (
        <View style={styles.chipsWrap}>
          {SUGGESTIONS.map(({ key, text, Icon }) => (
            <Pressable key={key} style={styles.chip} onPress={() => send(text)}>
              <Icon size={15} color={colors.accent} strokeWidth={1.75} />
              <Text style={styles.chipText}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent}>
          {messages.map((m, i) => (
            <View key={i} style={m.role === 'user' ? styles.rowRight : styles.rowLeft}>
              <View style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
                <Text style={m.role === 'user' ? styles.userText : styles.assistantText}>{m.content}</Text>
              </View>
              {m.showCalendarCta && m.role === 'assistant' && (
                <Pressable style={styles.calendarCta} onPress={addToCalendar}>
                  <CalendarCheck size={15} color={colors.accentText} strokeWidth={2} />
                  <Text style={styles.calendarCtaText}>Add to My Calendar</Text>
                </Pressable>
              )}
            </View>
          ))}
          {loading && <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start', marginTop: space.sm }} />}
        </ScrollView>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask your coach..."
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => send(draft)}
          returnKeyType="send"
          multiline
          maxLength={500}
        />
        <Pressable style={styles.sendBtn} onPress={() => send(draft)}>
          <ArrowUp size={18} color={colors.accentText} strokeWidth={2.25} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.lg },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  chipsWrap: { paddingHorizontal: space.xl, gap: space.sm, marginTop: space.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingVertical: space.md, paddingHorizontal: space.lg,
  },
  chipText: { fontSize: 15, color: colors.text },
  thread: { flex: 1 },
  threadContent: { paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.md },
  rowRight: { alignItems: 'flex-end', marginBottom: space.sm },
  rowLeft: { alignItems: 'flex-start', marginBottom: space.sm },
  userBubble: { backgroundColor: colors.accent, borderRadius: radius.md, borderBottomRightRadius: 4, paddingVertical: space.md, paddingHorizontal: space.lg, maxWidth: '82%' },
  userText: { fontSize: 15, color: colors.accentText, fontWeight: '500' },
  assistantBubble: { backgroundColor: colors.cardAlt, borderRadius: radius.md, borderBottomLeftRadius: 4, paddingVertical: space.md, paddingHorizontal: space.lg, maxWidth: '82%' },
  assistantText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  calendarCta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.accent, borderRadius: radius.sm, paddingVertical: space.sm, paddingHorizontal: space.md, marginTop: space.sm },
  calendarCtaText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, paddingHorizontal: space.lg, paddingVertical: space.md, maxHeight: 100, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
