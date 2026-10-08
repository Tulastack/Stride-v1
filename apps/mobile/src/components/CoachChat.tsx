import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { strideApi } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { palettes, radius, type as typo } from '../theme';
import { parseCoachReply, type CoachSection } from '../lib/parseCoachReply';
import { Button } from '../ui';
import { CoachPresence } from './CoachPresence';

const stage = palettes.dark;
const SUGGESTIONS = [
  { title: 'What should I fix first?', prompt: 'What should I fix first?' },
  { title: 'Create a 2-week plan', prompt: 'Create a 2-week plan' },
  { title: 'Recovery and fuel', prompt: 'How should I hydrate and recover?' },
  { title: 'Mindset and racing', prompt: 'How do I improve my mental game?' },
  { title: 'The next level', prompt: 'How can I get recruited?' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sections?: CoachSection[];
  calendarRelevant?: boolean;
}

export function CoachChat({ analysisId, initialPrompt, onScheduled }: {
  analysisId?: string;
  initialPrompt?: string;
  onScheduled?: () => void;
} = {}) {
  const { reduceMotion } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<'message' | 'schedule' | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduledReplies, setScheduledReplies] = useState<Set<number>>(new Set());
  const sessionId = useRef<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const started = useRef(false);
  const failedPlan = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!initialPrompt || started.current) return;
    started.current = true;
    send(initialPrompt);
  }, [initialPrompt]);

  async function send(question: string, retry = false) {
    const content = question.trim();
    if (!content || lock.current) return;
    lock.current = true;
    setLoading(true);
    setError('');
    setFailedAction(null);
    setLastQuestion(content);
    setDraft('');
    const history = retry && messages[messages.length - 1]?.role === 'user'
      && messages[messages.length - 1]?.content === content ? messages.slice(0, -1) : messages;
    if (!retry) setMessages((previous) => [...previous, { role: 'user', content }]);
    try {
      if (!sessionId.current) {
        const session = analysisId
          ? await strideApi.createCoachSession('analysis_workflow', analysisId)
          : await strideApi.createCoachSession('free_coach');
        sessionId.current = session.id;
      }
      const reply = await strideApi.askCoach(
        sessionId.current!,
        content,
        history.map((message) => ({ role: message.role, content: message.content })),
      );
      if (mounted.current) {
        setMessages((previous) => [...previous, {
          role: 'assistant', content: reply.content,
          sections: parseCoachReply(reply.content), calendarRelevant: reply.calendarRelevant === true,
        }]);
      }
    } catch (failure: any) {
      if (mounted.current) {
        setError(failure?.status === 429
          ? 'Your coach is busy right now. Give it a few minutes and try again.'
          : 'Could not reach your coach. Check your connection and try again.');
        setFailedAction('message');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setLoading(false);
        requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: !reduceMotion }));
      }
    }
  }

  async function schedule(replyIndex: number) {
    if (!sessionId.current || lock.current || scheduledReplies.has(replyIndex)) return;
    lock.current = true;
    failedPlan.current = replyIndex;
    setScheduling(true);
    setError('');
    setFailedAction(null);
    try {
      const result = await strideApi.addCoachPlanToCalendar(
        sessionId.current,
        messages.slice(0, replyIndex + 1).map((message) => ({ role: message.role, content: message.content })),
      );
      if (!mounted.current) return;
      setScheduledReplies((previous) => new Set([...previous, replyIndex]));
      setMessages((previous) => [...previous, {
        role: 'assistant',
        content: result.created > 0
          ? `${result.created} workouts added to your plan.`
          : 'No new workouts were added. Ask your coach for a specific training plan.',
      }]);
      if (result.created > 0) {
        onScheduled?.();
        router.push('/(tabs)/calendar');
      }
    } catch {
      if (mounted.current) {
        setError('Could not confirm that the plan was added. Check your calendar before retrying.');
        setFailedAction('schedule');
      }
    } finally {
      lock.current = false;
      if (mounted.current) setScheduling(false);
    }
  }

  const latestPlanReply = messages.reduce((latest, message, index) =>
    message.calendarRelevant ? index : latest, -1);
  const dockIndex = loading ? -1 : messages.reduce((found, message, index) => message.role === 'assistant' ? index : found, -1);
  const phase = loading ? 'reasoning' : dockIndex >= 0 ? 'docked' : 'idle';
  const earlier = dockIndex >= 0 ? messages.slice(0, dockIndex) : messages;
  const docked = dockIndex >= 0 ? messages[dockIndex] : null;

  function replyBody(message: Message) {
    if (!message.sections?.length) return <Text style={[typo.body, { color: stage.text }]}>{message.content}</Text>;
    return message.sections.map((section, position) => (
      <View key={position} style={{ gap: 8 }}>
        {section.title ? <Text style={[typo.h2, { color: stage.text }]}>{section.title}</Text> : null}
        {section.body ? <Text style={[typo.body, { color: stage.text }]}>{section.body}</Text> : null}
        {section.bullets.map((bullet, bulletIndex) => (
          <View key={bulletIndex} style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={[typo.caption, { color: stage.goldInk }]}>{String(bulletIndex + 1).padStart(2, '0')}</Text>
            <Text style={[typo.body, { color: stage.text, flex: 1 }]}>{bullet}</Text>
          </View>
        ))}
      </View>
    ));
  }

  function planButton(index: number) {
    if (index !== latestPlanReply || scheduledReplies.has(index)) return null;
    return <Button label="Add to My Calendar" loading={scheduling} disabled={loading} onPress={() => schedule(index)} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: stage.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, gap: 20, paddingHorizontal: 20, paddingBottom: 12 }}>
        {earlier.map((message, index) => (
          <View key={index} style={{ gap: 12, alignItems: message.role === 'user' ? 'flex-end' : 'stretch' }}>
            {message.role === 'user' ? (
              <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: stage.card, maxWidth: '90%' }}>
                <Text style={[typo.body, { color: stage.text }]}>{message.content}</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={[typo.label, { color: stage.goldInk }]}>YOUR COACH</Text>
                {replyBody(message)}
              </View>
            )}
            {planButton(index)}
          </View>
        ))}
        <CoachPresence phase={phase} reduceMotion={reduceMotion} status="Waiting for your coach"
          suggestions={phase === 'idle' && !messages.length ? SUGGESTIONS : undefined} onSuggest={(prompt) => send(prompt)}>
          {docked ? (
            <View style={{ gap: 12 }}>
              <Text style={[typo.label, { color: stage.goldInk }]}>YOUR COACH</Text>
              {replyBody(docked)}
              {planButton(dockIndex)}
            </View>
          ) : null}
        </CoachPresence>
        {error ? (
          <View style={{ gap: 8 }}>
            <Text style={[typo.body, { color: stage.error }]}>{error}</Text>
            <Button label={failedAction === 'schedule' ? 'Retry scheduling' : 'Retry message'} variant="secondary"
              onPress={() => failedAction === 'schedule' && failedPlan.current != null
                ? schedule(failedPlan.current) : send(lastQuestion, true)}
              disabled={loading || scheduling} />
          </View>
        ) : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 20, marginBottom: 8, paddingTop: 4, gap: 12, borderTopWidth: 0.5, borderColor: stage.border }}>
        <TextInput accessibilityLabel="Ask your coach" placeholder="Ask your coach"
          placeholderTextColor={stage.wellMuted} value={draft} onChangeText={setDraft} multiline
          maxLength={500} editable={!loading && !scheduling}
          style={[typo.body, { flex: 1, maxHeight: 96, minHeight: 48, paddingVertical: 12, color: stage.text }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message"
          accessibilityState={{ disabled: !draft.trim() || loading || scheduling }}
          disabled={!draft.trim() || loading || scheduling} onPress={() => send(draft)}
          style={{ minHeight: 48, justifyContent: 'center', paddingLeft: 4, opacity: !draft.trim() || loading || scheduling ? 0.35 : 1 }}>
          <Text style={[typo.bodyMedium, { color: stage.goldInk }]}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
