import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Send, Calendar, Dumbbell, Brain, Droplets, Users } from 'lucide-react-native';
import { strideApi } from '../services/api';
import { getAccessToken as getToken } from '../lib/supabase';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  hasCalendarAction?: boolean;
}

const SUGGESTIONS = [
  { icon: Dumbbell, text: 'What should I fix first?' },
  { icon: Brain, text: 'How do I improve my mental game?' },
  { icon: Droplets, text: 'How should I hydrate for sprinting?' },
  { icon: Users, text: 'How can I get recruited?' },
  { icon: Calendar, text: 'Create a 2-week training plan' },
];

function detectCalendarIntent(text: string): boolean {
  const keywords = ['calendar', 'schedule', 'plan my week', 'training plan', 'put on my calendar', 'add to calendar', 'spread out', 'workout plan', 'add this to your calendar', 'would you like me to add'];
  return keywords.some((k) => text.toLowerCase().includes(k));
}

function formatCoachResponse(raw: string): string {
  let formatted = raw;
  // Strip markdown bold/italic
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '$1');
  formatted = formatted.replace(/\*(.+?)\*/g, '$1');
  formatted = formatted.replace(/__(.+?)__/g, '$1');
  formatted = formatted.replace(/_(.+?)_/g, '$1');
  // Strip markdown headers
  formatted = formatted.replace(/^#{1,3}\s*/gm, '');
  // Strip backticks
  formatted = formatted.replace(/`(.+?)`/g, '$1');
  // Clean up excessive newlines
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  return formatted.trim();
}

export function CoachChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function addToCalendar(messageContent: string) {
    try {
      if (!sessionId.current) {
        Alert.alert('Error', 'No active session. Ask the coach for a plan first.');
        return;
      }
      setLoading(true);
      // Send conversation history so the backend knows what plan to create
      const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
      const resp = await fetch(
        `${require('../services/api').strideApi ? '' : ''}${process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/coach-sessions/${sessionId.current}/add-to-calendar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getToken()}` },
          body: JSON.stringify({ history: historyPayload }),
        }
      );
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Failed');
      Alert.alert('Added to Calendar', `${result.created} workouts scheduled! Check the Plan tab.`);
      setMessages((m) => [...m, { role: 'assistant', content: `✅ ${result.created} workouts added to your calendar! Spread across the next 2 weeks with rest days. Check the Plan tab to see them.` }]);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not add to calendar. Try asking for a specific plan first.');
    } finally {
      setLoading(false);
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    setInput('');

    const isCalendarRequest = detectCalendarIntent(content);
    setMessages((m) => [...m, { role: 'user', content }]);
    setLoading(true);

    try {
      if (!sessionId.current) {
        const session = await strideApi.createCoachSession('free_coach');
        sessionId.current = session.id;
      }

      const prompt = isCalendarRequest
        ? `${content}\n\nIMPORTANT: The user wants these workouts on their calendar. After providing the plan, offer to add it to their calendar. Structure the response with clear days and workouts.`
        : content;

      const reply = await strideApi.askCoach(sessionId.current!, prompt, messages);
      const formatted = formatCoachResponse(reply.content);

      setMessages((m) => [...m, {
        role: 'assistant',
        content: formatted,
        hasCalendarAction: isCalendarRequest || detectCalendarIntent(formatted),
      }]);
    } catch {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Sorry — I couldn\'t reach the coach. Check your connection and try again.',
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>AI COACH</Text>
        <Text style={styles.sub}>Ask about anything — form, training, nutrition, recovery, recruiting</Text>
      </View>

      {messages.length === 0 && (
        <View style={styles.chips}>
          {SUGGESTIONS.map(({ icon: Icon, text }) => (
            <TouchableOpacity key={text} style={styles.chip} onPress={() => send(text)}>
              <Icon size={14} color="#4F46E5" />
              <Text style={styles.chipText}>{text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {messages.length > 0 && (
        <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent}>
          {messages.map((m, i) => (
            <View key={i}>
              <View style={[styles.bubble, m.role === 'user' ? styles.user : styles.assistant]}>
                <Text style={m.role === 'user' ? styles.userText : styles.assistantText}>
                  {m.content}
                </Text>
              </View>
              {m.hasCalendarAction && m.role === 'assistant' && (
                <TouchableOpacity style={styles.calendarBtn} onPress={() => addToCalendar(m.content)}>
                  <Calendar size={14} color="#FFFFFF" />
                  <Text style={styles.calendarBtnText}>Add to My Calendar</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#4F46E5" size="small" />
              <Text style={styles.loadingText}>Thinking...</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about form, nutrition, recruiting, anything..."
          placeholderTextColor="#999999"
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
          multiline
          maxLength={500}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => send(input)} disabled={loading}>
          <Send color="#FFFFFF" size={18} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  headerRow: { gap: 4 },
  title: { fontSize: 20, fontWeight: '900', color: '#000000', letterSpacing: -0.5 },
  sub: { fontSize: 12, color: '#888888' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FAFAFA',
  },
  chipText: { fontSize: 13, color: '#333333', fontWeight: '500' },
  thread: { flex: 1 },
  threadContent: { gap: 10, paddingBottom: 8 },
  bubble: { padding: 12, borderRadius: 12, maxWidth: '88%' },
  user: { alignSelf: 'flex-end', backgroundColor: '#000000' },
  assistant: { alignSelf: 'flex-start', backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#EEEEEE' },
  userText: { fontSize: 14, color: '#FFFFFF', lineHeight: 20 },
  assistantText: { fontSize: 14, color: '#222222', lineHeight: 21 },
  calendarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#4F46E5', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, marginTop: 6,
  },
  calendarBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  loadingText: { fontSize: 12, color: '#888888' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#000000',
    maxHeight: 80, backgroundColor: '#FAFAFA',
  },
  sendBtn: {
    backgroundColor: '#000000', borderRadius: 12, padding: 10,
    justifyContent: 'center', alignItems: 'center',
  },
});
