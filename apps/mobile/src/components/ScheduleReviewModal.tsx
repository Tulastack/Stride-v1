import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { type as typo } from '../theme';
import { Sheet, SheetScroll, Button, Notice, IconButton } from '../ui';
import type { DrillRec } from '../types/analysis';
import { generateProposal, type ProposedSession } from '../lib/proposal';

export function ScheduleReviewModal({ visible, focus, startDate, onApprove, onClose }: { visible: boolean; focus: DrillRec | null; startDate: string; onApprove: (sessions: ProposedSession[]) => Promise<void> | void; onClose: () => void }) {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<ProposedSession[]>([]);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (visible && focus) { setSessions(generateProposal(focus, startDate)); setError(''); } }, [visible, focus, startDate]);
  const approve = async () => {
    if (!sessions.length || committing) return;
    setCommitting(true); setError('');
    try { await onApprove(sessions); onClose(); }
    catch { setError('Could not add these sessions. Your edits are kept here for retry.'); }
    finally { setCommitting(false); }
  };
  return <Sheet visible={visible} title="Review your plan" onClose={() => { if (!committing) onClose(); }}><View accessibilityLabel="schedule-review-modal" style={{ gap: 16 }}><Text style={[typo.body, { color: colors.muted }]}>Nothing is added until you approve. Remove any sessions that do not fit.</Text><SheetScroll style={{ maxHeight: 280 }}>{sessions.map((session) => <View key={session.id} accessibilityLabel={`proposed-${session.id}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: 0.5, borderColor: colors.border }}><View style={{ flex: 1 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>{session.title}</Text><Text style={[typo.caption, { color: colors.muted }]}>{session.scheduledDate} · {session.sets} × {session.reps}</Text></View><Button label="Remove" testID={`remove-${session.id}`} accessibilityLabel={`remove-${session.id}`} variant="quiet" disabled={committing} onPress={() => setSessions((previous) => previous.filter((item) => item.id !== session.id))} /></View>)}</SheetScroll>{!sessions.length ? <Notice>No sessions. Nothing will be added.</Notice> : null}{error ? <Notice tone="error">{error}</Notice> : null}<Button label="Add to calendar" testID="review-approve" accessibilityLabel="review-approve" disabled={!sessions.length} loading={committing} onPress={approve} /><Button label="Not now" testID="review-decline" accessibilityLabel="review-decline" disabled={committing} variant="quiet" onPress={onClose} /></View></Sheet>;
}
