// Calendar approval gate (PROMPT F.7). Shows the PROPOSED schedule; the user can
// remove sessions; NOTHING is written until the explicit "Add to calendar" tap.
// No auto-sync, no write on analysis completion.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { X, Check, Trash2 } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../ui/theme';
import type { DrillRec } from '../types/analysis';
import { generateProposal, type ProposedSession } from '../lib/proposal';

export function ScheduleReviewModal({
  visible,
  focus,
  startDate,
  onApprove,
  onClose,
}: {
  visible: boolean;
  focus: DrillRec | null;
  startDate: string;
  /** Called ONLY on explicit approval. This is the single write path. */
  onApprove: (sessions: ProposedSession[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<ProposedSession[]>([]);
  const [committing, setCommitting] = useState(false);

  // (Re)build the proposal when opened. Building is pure — no write.
  React.useEffect(() => {
    if (visible && focus) setSessions(generateProposal(focus, startDate));
  }, [visible, focus, startDate]);

  const remove = (id: string) => setSessions((s) => s.filter((x) => x.id !== id));

  const approve = async () => {
    setCommitting(true);
    await onApprove(sessions);
    setCommitting(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet} accessibilityLabel="schedule-review-modal">
          <View style={styles.header}>
            <Text style={styles.title}>Review your plan</Text>
            <Pressable onPress={onClose} testID="review-close" accessibilityLabel="review-close">
              <X size={20} color={semantic.text.muted} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Nothing is added to your calendar until you tap Add. Edit or remove sessions first.
          </Text>

          <ScrollView style={styles.list}>
            {sessions.map((s) => (
              <View key={s.id} style={styles.row} accessibilityLabel={`proposed-${s.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{s.title}</Text>
                  <Text style={styles.rowMeta}>
                    {s.scheduledDate} · {s.sets}×{s.reps}
                  </Text>
                </View>
                <Pressable onPress={() => remove(s.id)} testID={`remove-${s.id}`} accessibilityLabel={`remove-${s.id}`}>
                  <Trash2 size={16} color={semantic.status.flaw} />
                </Pressable>
              </View>
            ))}
            {sessions.length === 0 ? <Text style={styles.empty}>No sessions — nothing will be added.</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.decline} onPress={onClose} testID="review-decline" accessibilityLabel="review-decline">
              <Text style={styles.declineText}>Not now</Text>
            </Pressable>
            <Pressable
              style={[styles.approve, sessions.length === 0 && styles.approveDisabled]}
              onPress={approve}
              disabled={sessions.length === 0 || committing}
              testID="review-approve"
              accessibilityLabel="review-approve"
            >
              <Check size={16} color={semantic.text.onSignal} />
              <Text style={styles.approveText}>Add to calendar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(14,15,18,0.82)', justifyContent: 'center', padding: spacing.xl },
  sheet: {
    backgroundColor: semantic.surface.overlay,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...(typography.title as object), color: semantic.text.primary },
  subtitle: { ...(typography.caption as object), color: semantic.text.muted },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: semantic.border,
  },
  rowTitle: { ...(typography.bodyStrong as object), color: semantic.text.primary },
  rowMeta: { ...(typography.caption as object), color: semantic.text.muted },
  empty: { ...(typography.body as object), color: semantic.text.muted, paddingVertical: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  decline: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
  },
  declineText: { ...(typography.bodyStrong as object), color: semantic.text.secondary },
  approve: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: semantic.action.primary,
  },
  approveDisabled: { opacity: 0.4 },
  approveText: { ...(typography.bodyStrong as object), color: semantic.text.onSignal },
});
