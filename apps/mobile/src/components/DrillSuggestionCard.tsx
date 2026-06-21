import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { CheckCircle, XCircle, Calendar } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../ui/theme';

interface DrillSuggestion {
  id: string;
  drill_key: string;
  drill_name: string;
  suggested_date: string;
  status: 'pending' | 'approved' | 'skipped';
}

interface Props {
  suggestion: DrillSuggestion;
  onApprove: (id: string, date: string) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
}

export function DrillSuggestionCard({ suggestion, onApprove, onSkip }: Props) {
  const [status, setStatus] = useState(suggestion.status);
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date(suggestion.suggested_date);
    return isNaN(d.getTime()) ? new Date() : d;
  });

  const handleApproveConfirm = async () => {
    setLoading(true);
    setShowDatePicker(false);
    await onApprove(suggestion.id, selectedDate.toISOString().split('T')[0]);
    setStatus('approved');
    setLoading(false);
  };

  const generateDays = () => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  };

  if (status === 'skipped') return null;
  if (status === 'approved')
    return (
      <View style={[styles.card, styles.approvedCard]} testID={`suggestion-card-${suggestion.id}`}>
        <CheckCircle color={semantic.status.improve} size={18} />
        <Text style={styles.approvedText}>{suggestion.drill_name} — added to calendar</Text>
      </View>
    );

  return (
    <>
      <View style={styles.card} testID={`suggestion-card-${suggestion.id}`} accessibilityLabel={`suggestion-card-${suggestion.id}`}>
        <View style={styles.cardHeader}>
          <Calendar color={semantic.action.primary} size={16} />
          <Text style={styles.drillName}>{suggestion.drill_name}</Text>
        </View>
        <Text style={styles.dateText}>Suggested: {suggestion.suggested_date}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            testID={`skip-suggestion-${suggestion.id}`}
            accessibilityLabel={`skip-suggestion-${suggestion.id}`}
            style={[styles.btn, styles.skipBtn]}
            disabled={loading}
            onPress={async () => {
              setLoading(true);
              setStatus('skipped');
              try {
                await onSkip(suggestion.id);
              } catch {
                setStatus('pending');
              } finally {
                setLoading(false);
              }
            }}
          >
            <XCircle color={semantic.status.flaw} size={14} />
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`approve-suggestion-${suggestion.id}`}
            accessibilityLabel={`approve-suggestion-${suggestion.id}`}
            style={[styles.btn, styles.approveBtn]}
            disabled={loading}
            onPress={() => setShowDatePicker(true)}
          >
            <CheckCircle color={semantic.text.onSignal} size={14} />
            <Text style={styles.approveText}>Add to my plan</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={showDatePicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.datePickerContainer}>
            <Text style={styles.datePickerTitle}>Schedule Drill</Text>
            <Text style={styles.datePickerSubtitle}>{suggestion.drill_name}</Text>

            <View style={styles.daysRow}>
              {generateDays().map((d, i) => {
                const isSelected =
                  selectedDate.getDate() === d.getDate() && selectedDate.getMonth() === d.getMonth();
                const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = d.getDate();
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.dayButton, isSelected && styles.dayButtonSelected]}
                    onPress={() => setSelectedDate(d)}
                  >
                    <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>{dayName}</Text>
                    <Text style={[styles.dayNum, isSelected && styles.dayTextSelected]}>{dayNum}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowDatePicker(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`confirm-date-${suggestion.id}`}
                style={styles.modalConfirmBtn}
                onPress={handleApproveConfirm}
              >
                <Text style={styles.modalConfirmText}>Confirm Date</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: semantic.surface.raised,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  approvedCard: {
    borderColor: semantic.status.improve,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  approvedText: { color: semantic.status.improve, fontSize: 14, fontWeight: '600', flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  drillName: { color: semantic.text.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  dateText: { color: semantic.text.muted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    borderWidth: borderWidth.hairline,
  },
  skipBtn: { borderColor: semantic.border, backgroundColor: 'transparent' },
  approveBtn: { borderColor: semantic.action.primary, backgroundColor: semantic.action.primary },
  skipText: { color: semantic.status.flaw, fontWeight: '700', fontSize: 13 },
  approveText: { color: semantic.text.onSignal, fontWeight: '700', fontSize: 13 },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(14,15,18,0.82)',
  },
  datePickerContainer: {
    backgroundColor: semantic.surface.overlay,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    borderRadius: radius.md,
    padding: spacing.xl,
    width: '100%',
  },
  datePickerTitle: {
    ...(typography.title as object),
    color: semantic.text.primary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  datePickerSubtitle: {
    color: semantic.action.primary,
    fontSize: 14,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xxl },
  dayButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: semantic.surface.sunken,
  },
  dayButtonSelected: { backgroundColor: semantic.action.primary },
  dayName: { color: semantic.text.muted, fontSize: 12, marginBottom: spacing.xs },
  dayNum: { color: semantic.text.primary, fontSize: 16, fontWeight: 'bold' },
  dayTextSelected: { color: semantic.text.onSignal },
  modalActions: { flexDirection: 'row', gap: spacing.md },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    alignItems: 'center',
  },
  modalCancelText: { color: semantic.text.secondary, fontSize: 15, fontWeight: 'bold' },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: semantic.action.primary,
    alignItems: 'center',
  },
  modalConfirmText: { color: semantic.text.onSignal, fontSize: 15, fontWeight: 'bold' },
});
