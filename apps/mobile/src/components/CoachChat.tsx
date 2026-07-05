import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Send } from 'lucide-react-native';
import { strideApi } from '../services/api';
import { semantic, spacing, radius, borderWidth, typography } from '../ui/theme';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What should I fix first?',
  'How do I fix my overstriding?',
  'What should I eat before a session?',
  'How do I recover between hard days?',
];

/**
 * Ask-the-coach chat. Talks to the Groq coach, which is grounded in the
 * athlete's latest analysis and scoped to form / training / nutrition / recovery.
 */
export function CoachChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content }]);
    setLoading(true);
    try {
      if (!sessionId.current) {
        const session = await strideApi.createCoachSession('free_coach');
        sessionId.current = session.id;
      }
      const reply = await strideApi.askCoach(sessionId.current!, content);
      setMessages((m) => [...m, { role: 'assistant', content: reply.content }]);
    } catch (e: unknown) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Sorry — I could not reach the coach. Check your connection and try again.' },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <View style={styles.wrap} accessibilityLabel="coach-chat">
      <Text style={styles.title}>ASK YOUR COACH</Text>
      <Text style={styles.sub}>Grounded in your latest run · form, training, nutrition, recovery</Text>

      {messages.length === 0 && (
        <View style={styles.chips}>
          {SUGGESTIONS.map((s) => (
            <TouchableOpacity key={s} style={styles.chip} onPress={() => send(s)}>
              <Text style={styles.chipText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {messages.length > 0 && (
        <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={{ gap: spacing.sm }}>
          {messages.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'user' ? styles.user : styles.assistant]}>
              <Text style={m.role === 'user' ? styles.userText : styles.assistantText}>{m.content}</Text>
            </View>
          ))}
          {loading && <ActivityIndicator color={semantic.action.primary} style={{ alignSelf: 'flex-start' }} />}
        </ScrollView>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your form, training, food, recovery…"
          placeholderTextColor={semantic.text.muted}
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
          accessibilityLabel="coach-input"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => send(input)} disabled={loading} accessibilityLabel="coach-send">
          <Send color="#FFFFFF" size={18} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: borderWidth.hairline,
    borderColor: semantic.surface.overlay,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: semantic.surface.raised,
  },
  title: { ...typography.bodyStrong, color: semantic.text.primary },
  sub: { ...typography.caption, color: semantic.text.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: borderWidth.hairline, borderColor: semantic.surface.overlay,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  chipText: { ...typography.caption, color: semantic.text.secondary },
  thread: { maxHeight: 320 },
  bubble: { padding: spacing.sm, borderRadius: radius.md, maxWidth: '92%' },
  user: { alignSelf: 'flex-end', backgroundColor: semantic.action.primary },
  assistant: { alignSelf: 'flex-start', backgroundColor: semantic.surface.base, borderWidth: borderWidth.hairline, borderColor: semantic.surface.overlay },
  userText: { ...typography.body, color: '#FFFFFF' },
  assistantText: { ...typography.body, color: semantic.text.primary },
  inputRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  input: {
    flex: 1, borderWidth: borderWidth.hairline, borderColor: semantic.surface.overlay,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    color: semantic.text.primary, ...typography.body,
  },
  sendBtn: {
    backgroundColor: semantic.action.primary, borderRadius: radius.md,
    padding: spacing.sm, justifyContent: 'center', alignItems: 'center',
  },
});
