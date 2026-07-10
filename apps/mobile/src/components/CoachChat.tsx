import React, { useState, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { MessageCircle, ArrowUp, Zap, Brain, Droplet, Award, CalendarPlus, CalendarCheck } from 'lucide-react-native';
import { strideApi } from '../services/api';
import { getAccessToken as getToken } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { space, radius, iconStroke } from '../theme';

interface Msg { role: 'user' | 'assistant'; content: string; showCalendarCta?: boolean; }

const SUGGESTIONS = [
  { key: 'fix', text: 'What should I fix first?', Icon: Zap },
  { key: 'mental', text: 'How do I improve my mental game?', Icon: Brain },
  { key: 'hydrate', text: 'How should I hydrate?', Icon: Droplet },
  { key: 'recruit', text: 'How can I get recruited?', Icon: Award },
  { key: 'plan', text: 'Create a 2-week plan', Icon: CalendarPlus },
];

function detectCalendarIntent(text: string): boolean {
  const keywords = ['calendar', 'schedule', 'training plan', 'add to calendar', 'workout plan', '2-week', 'would you like me to add'];
  return keywords.some((k) => text.toLowerCase().includes(k));
}

function clean(raw: string): string {
  return raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/#{1,3}\s*/g, '').replace(/`(.+?)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

export function CoachChat() {
  const { colors } = useTheme();
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
      const resp = await fetch(`${baseUrl}/coach-sessions/${sessionId.current}/add-to-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Failed');
      setMessages((m) => [...m, { role: 'assistant', content: `✅ ${result.created} workouts added! Check the Plan tab.` }]);
    } catch (e: any) { Alert.alert('Error', e.message || 'Could not add to calendar.'); }
    finally { setLoading(false); }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    setDraft('');
    const isCal = detectCalendarIntent(content);
    setMessages((m) => [...m, { role: 'user', content }]);
    setLoading(true);
    try {
      if (!sessionId.current) { const s = await strideApi.createCoachSession('free_coach'); sessionId.current = s.id; }
      const prompt = isCal ? `${content}\n\nOffer to add workouts to their calendar.` : content;
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const reply = await strideApi.askCoach(sessionId.current!, prompt, history);
      const formatted = clean(reply.content);
      setMessages((m) => [...m, { role: 'assistant', content: formatted, showCalendarCta: isCal || detectCalendarIntent(formatted) }]);
    } catch { setMessages((m) => [...m, { role: 'assistant', content: 'Couldn\'t reach the coach. Check connection.' }]); }
    finally { setLoading(false); requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={[styles.header]}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.h1, { color: colors.text }]}>AI COACH</Text>
          <MessageCircle size={20} color={colors.accent} strokeWidth={iconStroke} />
        </View>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Ask about anything — form, training, nutrition, recovery, recruiting</Text>
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
              <View style={[m.role === 'user' ? styles.userBubble : styles.assistantBubble, m.role === 'user' ? { backgroundColor: colors.accent } : { backgroundColor: colors.cardAlt }]}>
                <Text style={[m.role === 'user' ? styles.userText : styles.assistantText, m.role === 'user' ? { color: colors.accentText } : { color: colors.text }]}>{m.content}</Text>
              </View>
              {m.showCalendarCta && m.role === 'assistant' && (
                <Pressable style={[styles.calCta, { backgroundColor: colors.accent }]} onPress={addToCalendar}>
                  <CalendarCheck size={15} color={colors.accentText} strokeWidth={2} />
                  <Text style={[styles.calCtaText, { color: colors.accentText }]}>Add to My Calendar</Text>
                </Pressable>
              )}
            </View>
          ))}
          {loading && <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start', marginTop: space.sm }} />}
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
  rowLeft: { alignItems: 'flex-start', marginBottom: space.sm },
  userBubble: { borderRadius: radius.md, borderBottomRightRadius: 4, paddingVertical: space.md, paddingHorizontal: space.lg, maxWidth: '82%' },
  userText: { fontSize: 15, fontWeight: '500' },
  assistantBubble: { borderRadius: radius.md, borderBottomLeftRadius: 4, paddingVertical: space.md, paddingHorizontal: space.lg, maxWidth: '82%' },
  assistantText: { fontSize: 15, lineHeight: 21 },
  calCta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm, paddingVertical: space.sm, paddingHorizontal: space.md, marginTop: space.sm },
  calCtaText: { fontSize: 15, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, maxHeight: 100, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
