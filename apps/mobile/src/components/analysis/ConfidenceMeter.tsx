// 3-bar confidence meter (PROMPT F.3-UI revised). Compact, mono-adjacent.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { semantic, spacing, typography } from '../../ui/theme';
import { confidenceTier } from '../../types/analysis';

export function ConfidenceMeter({ confidence, testID }: { confidence: number; testID?: string }) {
  const tier = confidenceTier(confidence);
  const lit = tier === 'high' ? 3 : tier === 'med' ? 2 : 1;
  const color = tier === 'low' ? semantic.text.muted : semantic.action.primary;
  return (
    <View style={styles.row} testID={testID} accessibilityLabel={`confidence-${tier}`}>
      <View style={styles.bars}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: 6 + i * 4, backgroundColor: i < lit ? color : semantic.surface.sunken },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.pct, { color }]}>{Math.round(confidence * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 4, borderRadius: 1 },
  pct: { ...(typography.metricSmall as object), color: semantic.text.muted },
});
