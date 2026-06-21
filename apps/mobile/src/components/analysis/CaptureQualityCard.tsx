// Capture-quality card (PROMPT F.3-UI revised, task 3).
// A single, calm line. Shows captureQuality.primaryNudge ONLY when present —
// never nag when the capture is good.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Camera, CheckCircle2 } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../../ui/theme';
import type { CaptureQuality } from '../../types/analysis';

export function CaptureQualityCard({ capture, testID }: { capture: CaptureQuality; testID?: string }) {
  const hasNudge = typeof capture.primaryNudge === 'string' && capture.primaryNudge.length > 0;
  return (
    <View style={styles.card} testID={testID} accessibilityLabel="capture-quality-card">
      <View style={styles.header}>
        {hasNudge ? (
          <Camera size={14} color={semantic.action.primary} />
        ) : (
          <CheckCircle2 size={14} color={semantic.status.improve} />
        )}
        <Text style={styles.title}>CAPTURE · {capture.fps}fps · {Math.round(capture.overall * 100)}%</Text>
      </View>
      {hasNudge ? (
        <Text style={styles.nudge} accessibilityLabel="capture-nudge">
          {capture.primaryNudge}
        </Text>
      ) : (
        <Text style={styles.good} accessibilityLabel="capture-good">
          Great angle — every metric on this run is trustworthy.
        </Text>
      )}
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
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 1 },
  nudge: { ...(typography.body as object), color: semantic.text.primary },
  good: { ...(typography.body as object), color: semantic.text.secondary },
});
