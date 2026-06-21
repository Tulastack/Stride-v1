// "Comparable across angles" badge (PROMPT F.3-UI revised, task 4).
// The differentiator: this metric is canonical-frame, so it can be compared to
// past uploads regardless of filming angle. Legible, not loud.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Globe } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../../ui/theme';

export function ComparableBadge({ testID }: { testID?: string }) {
  return (
    <View style={styles.badge} testID={testID} accessibilityLabel="comparable-across-angles">
      <Globe size={11} color={semantic.text.muted} />
      <Text style={styles.label}>comparable across angles</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  label: { ...(typography.caption as object), color: semantic.text.muted },
});
