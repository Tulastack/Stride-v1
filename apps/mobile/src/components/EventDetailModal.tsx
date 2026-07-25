// Calendar entry detail sheet — tapping a day's event used to mark it complete
// instantly, with no way to see what the session actually involves. This shows
// what to do and why (drawn from the reference drill / flaw that generated the
// session) before the athlete commits to "done".
import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { X, CheckCircle2 } from 'lucide-react-native';
import { space, radius } from '../theme';

type DetailEvent = {
  id: string;
  title: string;
  event_type: string;
  details?: {
    sets?: number;
    reps?: number;
    volume?: string;
    cue?: string;
    why?: string;
    cues?: string[];
  };
};

export function EventDetailModal({
  event,
  colors,
  onClose,
  onComplete,
}: {
  event: DetailEvent | null;
  colors: { bg: string; text: string; muted: string; border: string; card: string; accent: string; success: string };
  onClose: () => void;
  onComplete: (event: DetailEvent) => void;
}) {
  const visible = event !== null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityLabel="event-detail-modal">
          {event && (
            <>
              <View style={styles.header}>
                <Text style={[styles.title, { color: colors.text }]}>{event.title}</Text>
                <Pressable onPress={onClose} hitSlop={12} testID="event-detail-close" accessibilityLabel="event-detail-close">
                  <X size={20} color={colors.muted} />
                </Pressable>
              </View>

              <ScrollView style={styles.body}>
                {(event.details?.sets && event.details?.reps) ? (
                  <Text style={[styles.volume, { color: colors.text }]}>
                    {event.details.sets} sets × {event.details.reps} reps
                  </Text>
                ) : event.details?.volume ? (
                  <Text style={[styles.volume, { color: colors.text }]}>{event.details.volume}</Text>
                ) : null}

                {event.details?.cue ? (
                  <Text style={[styles.cue, { color: colors.muted }]}>{event.details.cue}</Text>
                ) : null}

                {event.details?.why ? (
                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: colors.muted }]}>WHY THIS HELPS</Text>
                    <Text style={[styles.why, { color: colors.text }]}>{event.details.why}</Text>
                  </View>
                ) : null}

                {event.details?.cues && event.details.cues.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: colors.muted }]}>KEY CUES</Text>
                    {event.details.cues.map((c, i) => (
                      <Text key={i} style={[styles.cueItem, { color: colors.text }]}>{'•'} {c}</Text>
                    ))}
                  </View>
                ) : null}

                {!event.details?.why && !event.details?.cues?.length ? (
                  <Text style={[styles.noDetail, { color: colors.muted }]}>
                    No extra detail for this session — follow the cue above.
                  </Text>
                ) : null}
              </ScrollView>

              <Pressable
                style={[styles.completeBtn, { backgroundColor: colors.accent }]}
                onPress={() => onComplete(event)}
                testID="event-detail-complete"
                accessibilityLabel="event-detail-complete"
              >
                <CheckCircle2 size={18} color="#FFFFFF" />
                <Text style={styles.completeText}>Mark complete</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: space.xl,
    gap: space.md,
    maxHeight: '75%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  title: { fontSize: 20, fontWeight: '800', flex: 1 },
  body: { gap: space.md },
  volume: { fontSize: 15, fontWeight: '700' },
  cue: { fontSize: 13, fontStyle: 'italic' },
  section: { marginTop: space.md, gap: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  why: { fontSize: 14, lineHeight: 20 },
  cueItem: { fontSize: 14, lineHeight: 20 },
  noDetail: { fontSize: 13, fontStyle: 'italic', marginTop: space.sm },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
  completeText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
