import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStrideStore } from '../store/useStrideStore';
import { FULL_COACH_ACCESS, NO_COACH_ACCESS, proposalDetails, usageCaption, type CoachPermissions, type CoachProposal, type CoachUsage } from '../lib/coachAccess';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, Switch } from 'react-native';
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
  actions?: CoachProposal[];
}

export function CoachChat({ analysisId, initialPrompt, onScheduled }: {
  analysisId?: string;
  initialPrompt?: string;
  onScheduled?: () => void;
} = {}) {
  const { reduceMotion, setAppearance, appearance, setReduceMotion } = useTheme();
  const userId = useStrideStore((s) => s.user?.id);
  const identityGeneration = useRef(0);
  const [permissions, setPermissions] = useState<CoachPermissions>(NO_COACH_ACCESS);
  const [usage, setUsage] = useState<CoachUsage | null>(null);
  const outOfMessages = usage?.remaining === 0;
  useEffect(() => {
    setUsage(null);
    if (!userId) return;
    let active = true;
    strideApi.getCoachUsage().then((u) => { if (active) setUsage(u); }).catch(() => {});
    return () => { active = false; };
  }, [userId]);
  const [accessReady, setAccessReady] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [handledActions, setHandledActions] = useState<Record<string, 'Applied' | 'Dismissed'>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let active = true;
    identityGeneration.current++; lock.current = false;
    setLoading(false); setScheduling(false); setApplying(null);
    setPermissions(NO_COACH_ACCESS); setAccessReady(false);
    setMessages([]); setHandledActions({}); sessionId.current = null; started.current = false;
    if (!userId) { setAccessReady(true); return; }
    AsyncStorage.getItem(`stride.coachAccess.${userId}`).then((saved) => {
      if (!active) return;
      if (saved) {
        const parsed = JSON.parse(saved);
        setPermissions(Object.fromEntries(Object.keys(NO_COACH_ACCESS).map((key) => [key, parsed[key] === true])) as unknown as CoachPermissions);
      }
    }).catch(() => {}).finally(() => { if (active) setAccessReady(true); });
    return () => { active = false; };
  }, [userId]);
  function grantFullAccess() {
    setPermissions(FULL_COACH_ACCESS);
    if (userId) AsyncStorage.setItem(`stride.coachAccess.${userId}`, JSON.stringify(FULL_COACH_ACCESS)).catch(() => {});
  }
  function changeAccess(key: keyof CoachPermissions, value: boolean) {
    const next = { ...permissions, [key]: value };
    if (permissions[key] && !value) {
      // Prior replies may contain data from the revoked category. Do not send
      // that history back to the provider under the new permissions.
      setMessages([]); setHandledActions({}); sessionId.current = null;
      setError(''); setActionError('');
    }
    setPermissions(next);
    if (userId) AsyncStorage.setItem(`stride.coachAccess.${userId}`, JSON.stringify(next)).catch(() => {});
  }
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
    if (!accessReady || !initialPrompt || started.current) return;
    started.current = true;
    send(initialPrompt);
  }, [initialPrompt, accessReady]);

  async function send(question: string, retry = false) {
    const content = question.trim();
    if (!content || lock.current || !accessReady || outOfMessages) return;
    const generation = identityGeneration.current;
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
        if (!mounted.current || generation !== identityGeneration.current) return;
        sessionId.current = session.id;
      }
      const reply = await strideApi.askCoach(
        sessionId.current!,
        content,
        history.map((message) => ({ role: message.role, content: message.content })),
        permissions,
        permissions.app ? { appearance, reduceMotion } : undefined,
      );
      if (mounted.current && generation === identityGeneration.current) {
        if (reply.usage) setUsage(reply.usage);
        setMessages((previous) => [...previous, {
          role: 'assistant', content: reply.content,
          sections: parseCoachReply(reply.content), calendarRelevant: reply.calendarRelevant === true, actions: reply.actions,
        }]);
      }
    } catch (failure: any) {
      if (mounted.current && generation === identityGeneration.current) {
        if (failure?.code === 'COACH_CAP_REACHED') {
          strideApi.getCoachUsage().then(setUsage).catch(() => {});
          setError('');
        } else {
          setError(failure?.status === 429
            ? 'Your coach is busy right now. Give it a few minutes and try again.'
            : 'Could not reach your coach. Check your connection and try again.');
          setFailedAction('message');
        }
      }
    } finally {
      if (generation === identityGeneration.current) lock.current = false;
      if (mounted.current && generation === identityGeneration.current) {
        setLoading(false);
        requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: !reduceMotion }));
      }
    }
  }

  async function schedule(replyIndex: number) {
    if (!sessionId.current || lock.current || scheduledReplies.has(replyIndex)) return;
    const generation = identityGeneration.current;
    lock.current = true;
    failedPlan.current = replyIndex;
    setScheduling(true);
    setError('');
    setFailedAction(null);
    try {
      const result = await strideApi.addCoachPlanToCalendar(
        sessionId.current,
        messages.slice(0, replyIndex + 1).map((message) => ({ role: message.role, content: message.content })),
        permissions,
      );
      if (!mounted.current || generation !== identityGeneration.current) return;
      setScheduledReplies((previous) => new Set([...previous, replyIndex]));
      setMessages((previous) => [...previous, {
        role: 'assistant',
        actions: result.actions,
        content: result.actions?.length ? 'Review the proposed sessions below before adding them.' : result.created > 0
          ? `${result.created} workouts added to your plan.`
          : 'No new workouts were added. Ask your coach for a specific training plan.',
      }]);
      if (result.created > 0) {
        onScheduled?.();
        router.push('/(tabs)/calendar');
      }
    } catch {
      if (mounted.current && generation === identityGeneration.current) {
        setError('Could not confirm that the plan was added. Check your calendar before retrying.');
        setFailedAction('schedule');
      }
    } finally {
      if (generation === identityGeneration.current) lock.current = false;
      if (mounted.current && generation === identityGeneration.current) setScheduling(false);
    }
  }

  async function applyAction(proposal: CoachProposal) {
    if (!sessionId.current || lock.current) return;
    const generation = identityGeneration.current;
    lock.current = true; setApplying(proposal.token); setActionError('');
    try {
      const result = await strideApi.applyCoachAction(sessionId.current, proposal.token, permissions);
      if (!mounted.current || generation !== identityGeneration.current) return;
      if (result.user) useStrideStore.getState().setUser(result.user);
      const a = result.action;
      if (a.kind === 'appearance') setAppearance(a.value);
      if (a.kind === 'reduce_motion') setReduceMotion(a.value === true);
      if (a.kind === 'navigate') {
        const path = a.screen === 'capture' ? '/(tabs)/' : `/(tabs)/${a.screen}`;
        router.push(a.analysisId ? { pathname: path as any, params: { analysisId: a.analysisId } } : path as any);
      }
      if (['create_events', 'update_event', 'delete_event', 'set_event_status', 'approve_suggestion'].includes(a.kind)) onScheduled?.();
      setHandledActions((old) => ({ ...old, [proposal.token]: 'Applied' }));
    } catch (failure: any) {
      if (mounted.current && generation === identityGeneration.current) setActionError(failure?.message || 'Could not apply the change. Retry with this same approval.');
    } finally { if (generation === identityGeneration.current) lock.current = false; if (mounted.current && generation === identityGeneration.current) setApplying(null); }
  }
  function actionCards(message: Message) {
    return (message.actions ?? []).map((proposal) => <View key={proposal.token} style={{ padding: 14, borderWidth: 1, borderColor: stage.border, borderRadius: radius.md, gap: 10 }}>
      <Text style={[typo.bodyMedium, { color: stage.text }]}>{proposal.label}</Text>
      <Text style={[typo.caption, { color: stage.wellMuted }]}>{proposalDetails(proposal)}</Text>
      {handledActions[proposal.token] ? <Text style={[typo.caption, { color: stage.goldInk }]}>{handledActions[proposal.token]}</Text> : <>
        <Button label="Review and apply" loading={applying === proposal.token} disabled={loading || scheduling || applying !== null} onPress={() => applyAction(proposal)} />
        <Button label="Dismiss change" variant="quiet" disabled={applying !== null} onPress={() => setHandledActions((old) => ({ ...old, [proposal.token]: 'Dismissed' }))} />
      </>}
    </View>);
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
    if (index !== latestPlanReply || scheduledReplies.has(index) || !permissions.calendar) return null;
    return <Button label="Add to My Calendar" loading={scheduling} disabled={loading} onPress={() => schedule(index)} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: stage.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, gap: 20, paddingHorizontal: 20, paddingBottom: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Coach access" onPress={() => setAccessOpen(!accessOpen)}><Text style={[typo.caption, { color: stage.goldInk }]}>Coach access · {Object.values(permissions).filter(Boolean).length} of 4 enabled</Text></Pressable>
        {accessOpen ? <View style={{ gap: 12 }}>
          <Text style={[typo.caption, { color: stage.wellMuted }]}>Choose which app data your coach may send to the AI provider. Every proposed change needs your review. Turn access off here at any time. Turning access off clears this conversation to remove its shared context.</Text>
          {(Object.keys(NO_COACH_ACCESS) as (keyof CoachPermissions)[]).map((key) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[typo.body, { color: stage.text }]}>{({ analysis: 'Analysis, progress and drills', calendar: 'Calendar and workouts', profile: 'Profile and recovery status', app: 'App controls and sessions' })[key]}</Text>
            <Switch accessibilityLabel={`Allow coach ${key} access`} value={permissions[key]} disabled={loading || scheduling || applying !== null} onValueChange={(value) => changeAccess(key, value)} />
          </View>)}
        </View> : null}
        {accessReady && !accessOpen && !Object.values(permissions).some(Boolean) ? (
          <View style={{ padding: 14, borderWidth: 1, borderColor: stage.border, borderRadius: radius.md, gap: 10 }}>
            <Text style={[typo.bodyMedium, { color: stage.text }]}>Get coaching built on your own data</Text>
            <Text style={[typo.caption, { color: stage.wellMuted }]}>With access, your coach reads your analyses, progress, calendar, profile and app settings, and sends what each question needs to our AI provider to answer it. Every change it proposes waits for your review. Change this any time under Coach access.</Text>
            <Button label="Allow full access" onPress={grantFullAccess} />
            <Button label="Choose what to share" variant="quiet" onPress={() => setAccessOpen(true)} />
          </View>
        ) : null}
        {actionError ? <Text accessibilityRole="alert" style={[typo.body, { color: stage.error }]}>{actionError}</Text> : null}
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
                {actionCards(message)}
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
              {actionCards(docked)}
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
      {usageCaption(usage) ? (
        <Text accessibilityLiveRegion="polite" style={[typo.caption, { color: outOfMessages ? stage.goldInk : stage.wellMuted, marginHorizontal: 20 }]}>{usageCaption(usage)}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 20, marginBottom: 8, paddingTop: 4, gap: 12, borderTopWidth: 0.5, borderColor: stage.border }}>
        <TextInput accessibilityLabel="Ask your coach" placeholder={outOfMessages ? 'Coach messages used' : 'Ask your coach'}
          placeholderTextColor={stage.wellMuted} value={draft} onChangeText={setDraft} multiline
          maxLength={500} editable={accessReady && !loading && !scheduling && !applying && !outOfMessages}
          style={[typo.body, { flex: 1, maxHeight: 96, minHeight: 48, paddingVertical: 12, color: stage.text }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message"
          accessibilityState={{ disabled: !draft.trim() || loading || scheduling || applying !== null || !accessReady || outOfMessages }}
          disabled={!draft.trim() || loading || scheduling || applying !== null || !accessReady || outOfMessages} onPress={() => send(draft)}
          style={{ minHeight: 48, justifyContent: 'center', paddingLeft: 4, opacity: !draft.trim() || loading || scheduling || applying !== null || !accessReady || outOfMessages ? 0.35 : 1 }}>
          <Text style={[typo.bodyMedium, { color: stage.goldInk }]}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
