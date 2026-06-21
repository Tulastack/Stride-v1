// Visual-demo drill card (PROMPT F.4). Pairs the user's flaw frame with a loop
// of the correct movement, the cue, sets/reps, and the "why this fixes it" line.
// Every DrillRec MUST resolve to a demoAssetId — an orphan rec is a bug.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PlayCircle, User } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../../ui/theme';
import { resolveDemoAsset } from '@stride/content';
import type { DrillRec } from '../../types/analysis';

export function DrillCard({ rec, testID }: { rec: DrillRec; testID?: string }) {
  const asset = resolveDemoAsset(rec.demoAssetId);
  return (
    <View style={styles.card} testID={testID} accessibilityLabel={`drill-${rec.drillId}`}>
      <Text style={styles.kicker}>YOUR FIX</Text>
      <Text style={styles.name}>{rec.drillName}</Text>

      <View style={styles.frames}>
        <View style={styles.frame}>
          <User size={20} color={semantic.text.muted} />
          <Text style={styles.frameLabel}>your form</Text>
        </View>
        <View style={[styles.frame, styles.demoFrame]} accessibilityLabel={`demo-${rec.demoAssetId}`} testID={`demo-${rec.demoAssetId}`}>
          <PlayCircle size={22} color={semantic.action.primary} />
          <Text style={[styles.frameLabel, { color: semantic.action.primary }]}>
            {asset ? 'correct form' : 'demo missing'}
          </Text>
        </View>
      </View>

      <Text style={styles.cue}>{rec.cue}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{rec.sets} × {rec.reps}</Text>
        <Text style={styles.rationale}>{rec.rationale}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: semantic.surface.overlay,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  kicker: { ...(typography.caption as object), color: semantic.action.primary, letterSpacing: 1 },
  name: { ...(typography.title as object), color: semantic.text.primary },
  frames: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm },
  frame: {
    flex: 1,
    height: 84,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    backgroundColor: semantic.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  demoFrame: { borderColor: semantic.action.primary },
  frameLabel: { ...(typography.caption as object), color: semantic.text.muted },
  cue: { ...(typography.bodyStrong as object), color: semantic.text.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  meta: { ...(typography.metricSmall as object), color: semantic.action.primary, fontSize: 16 },
  rationale: { ...(typography.caption as object), color: semantic.text.secondary, flex: 1 },
});
