// Flaw card with an opt-in "Show the numbers" drawer (PROMPT F.3 + F.3-UI revised).
// Leads with plain language; the numbers (measured band overlapping the normal
// range) are opt-in, and confidence is shown — never a fake single number.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../../ui/theme';
import { ConfidenceMeter } from './ConfidenceMeter';
import { ComparableBadge } from './ComparableBadge';
import { confidenceTier, type Flaw } from '../../types/analysis';

const SEVERITY_LABEL = { 1: 'MINOR', 2: 'MODERATE', 3: 'MAJOR' } as const;

export function FlawCard({ flaw, testID }: { flaw: Flaw; testID?: string }) {
  const [open, setOpen] = useState(false);
  const e = flaw.evidence;
  const low = confidenceTier(e.measured.confidence) === 'low';

  return (
    <View style={styles.card} testID={testID} accessibilityLabel={`flaw-${flaw.id}`}>
      <View style={styles.header}>
        <Text style={styles.name}>{flaw.name}</Text>
        <View style={[styles.sevTag, { borderColor: semantic.status.flaw }]}>
          <Text style={[styles.sevText, { color: semantic.status.flaw }]}>{SEVERITY_LABEL[flaw.severity]}</Text>
        </View>
      </View>

      <Text style={styles.explanation}>{flaw.plainExplanation}</Text>

      <Pressable
        style={styles.drawerToggle}
        onPress={() => setOpen((v) => !v)}
        testID={`show-numbers-${flaw.id}`}
        accessibilityLabel={`show-numbers-${flaw.id}`}
      >
        {open ? (
          <ChevronDown size={14} color={semantic.text.muted} />
        ) : (
          <ChevronRight size={14} color={semantic.text.muted} />
        )}
        <Text style={styles.drawerLabel}>{open ? 'Hide the numbers' : 'Show the numbers'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.drawer} testID={`numbers-${flaw.id}`}>
          <View style={styles.numbersRow}>
            <View>
              <Text style={styles.numLabel}>MEASURED</Text>
              <Text style={[styles.numValue, low && { color: semantic.text.muted }]}>
                {e.measured.value}°
              </Text>
              <Text style={styles.numBand}>
                band {e.measured.low}°–{e.measured.high}°
              </Text>
            </View>
            <View>
              <Text style={styles.numLabel}>NORMAL</Text>
              <Text style={styles.numValue}>
                {e.normalRange[0]}–{e.normalRange[1]}°
              </Text>
              <Text style={styles.numBand}>target range</Text>
            </View>
            <View>
              <Text style={styles.numLabel}>CONFIDENCE</Text>
              <ConfidenceMeter confidence={e.measured.confidence} />
              {low ? <Text style={styles.lowNote}>view-limited</Text> : null}
            </View>
          </View>
          <ComparableBadge testID={`comparable-${flaw.id}`} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: semantic.surface.raised,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { ...(typography.title as object), color: semantic.text.primary, flex: 1 },
  sevTag: { borderWidth: borderWidth.hairline, borderRadius: radius.sm, paddingVertical: 2, paddingHorizontal: spacing.sm },
  sevText: { ...(typography.caption as object), letterSpacing: 1 },
  explanation: { ...(typography.body as object), color: semantic.text.secondary },
  drawerToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  drawerLabel: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 1 },
  drawer: {
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: semantic.border,
  },
  numbersRow: { flexDirection: 'row', justifyContent: 'space-between' },
  numLabel: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 1, marginBottom: 2 },
  numValue: { ...(typography.metricSmall as object), fontSize: 18, lineHeight: 22, color: semantic.text.primary },
  numBand: { ...(typography.caption as object), color: semantic.text.muted },
  lowNote: { ...(typography.caption as object), color: semantic.status.flaw, marginTop: 2 },
});
