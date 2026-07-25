// A single metric with its confidence band + meter (PROMPT F.3-UI revised).
// Low-confidence metrics are visually demoted (muted) and labeled — never hidden
// silently, never shown as if solid. False precision is a bug.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { semantic, spacing, typography } from '../../ui/theme';
import { ConfidenceMeter } from './ConfidenceMeter';
import { confidenceTier, metricLabel, type Metric } from '../../types/analysis';
import { isExperimentalMetric } from '../../lib/validationStatus';

export function MetricRow({ metric, usable, testID }: { metric: Metric; usable?: boolean; testID?: string }) {
  const tier = confidenceTier(metric.measured.confidence);
  const low = tier === 'low' || usable === false;
  const experimental = isExperimentalMetric(metric.key, metric.trustStatus);
  const [rangeLow, rangeHigh] = metric.normalRange ?? [];
  const inRange = rangeLow != null && rangeHigh != null
    ? metric.measured.value >= rangeLow && metric.measured.value <= rangeHigh
    : null;
  const valueColor = low
    ? semantic.text.muted
    : inRange === true
    ? semantic.status.improve
    : inRange === false
    ? semantic.status.flaw
    : semantic.text.primary;

  return (
    <View style={styles.row} testID={testID} accessibilityLabel={`metric-${metric.key}`}>
      <View style={styles.left}>
        <Text style={[styles.label, low && styles.mutedLabel]}>{metricLabel(metric.key)}</Text>
        <View style={styles.tags}>
          {low ? (
            <Text style={styles.lowTag} accessibilityLabel={`metric-${metric.key}-lowconf`}>
              low confidence
            </Text>
          ) : null}
          {experimental ? (
            <Text style={styles.experimentalTag} accessibilityLabel={`metric-${metric.key}-experimental`}>
              experimental
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.value, { color: valueColor }]}>
          {metric.measured.value}
          <Text style={styles.unit}>{metric.unit === '°' ? metric.unit : ` ${metric.unit}`}</Text>
        </Text>
        <Text style={styles.band}>
          {metric.measured.low}–{metric.measured.high}{metric.unit === '°' ? metric.unit : ` ${metric.unit}`}
        </Text>
        <ConfidenceMeter confidence={metric.measured.confidence} testID={`meter-${metric.key}`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  left: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  right: { alignItems: 'flex-end', gap: 2 },
  label: { ...(typography.bodyStrong as object), color: semantic.text.primary },
  mutedLabel: { color: semantic.text.muted },
  lowTag: { ...(typography.caption as object), color: semantic.status.flaw },
  experimentalTag: { ...(typography.caption as object), color: semantic.text.muted, fontStyle: 'italic' },
  value: { ...(typography.metricSmall as object), fontSize: 18, lineHeight: 22 },
  unit: { ...(typography.caption as object), color: semantic.text.muted },
  band: { ...(typography.caption as object), color: semantic.text.muted },
});
