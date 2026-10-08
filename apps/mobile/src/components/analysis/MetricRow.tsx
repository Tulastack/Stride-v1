import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { space, type as typo } from '../../theme';
import { confidenceTier, metricLabel, type Metric } from '../../types/analysis';
import { isExperimentalMetric } from '../../lib/validationStatus';
import { ConfidenceMeter } from './ConfidenceMeter';

export function MetricRow({ metric, usable, testID }: { metric: Metric; usable?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const low = !Number.isFinite(metric.measured.value) || !Number.isFinite(metric.measured.confidence) || confidenceTier(metric.measured.confidence) === 'low' || usable === false;
  const experimental = isExperimentalMetric(metric.key, metric.trustStatus);
  const withheld = low || experimental;
  const unit = metric.unit;
  return <View testID={testID} style={{ borderBottomWidth: 0.5, borderColor: colors.border }}>
    <Pressable accessibilityRole="button" testID={`metric-${metric.key}`} accessibilityLabel={metricLabel(metric.key)} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>{metricLabel(metric.key)}</Text>{low ? <Text testID={`metric-${metric.key}-lowconf`} style={[typo.caption, { color: colors.muted }]}>low confidence · reading withheld</Text> : null}{experimental ? <Text testID={`metric-${metric.key}-experimental`} style={[typo.caption, { color: colors.muted }]}>experimental · not a confirmed observation</Text> : null}</View>
      <Text style={[typo.h2, { color: withheld ? colors.muted : colors.text, fontVariant: ['tabular-nums'] }]}>{withheld ? 'Withheld' : `${metric.measured.value}${unit === '°' ? unit : ' ' + unit}`}</Text>
      {open ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}
    </Pressable>
    {open ? <View style={{ paddingBottom: space.lg, gap: 12 }}>
      <ConfidenceMeter confidence={metric.measured.confidence} testID={`meter-${metric.key}`} />
      <View style={{ flexDirection: 'row', gap: 24 }}><View style={{ flex: 1 }}><Text style={[typo.label, { color: colors.muted }]}>UNCERTAINTY BAND</Text><Text style={[typo.body, { color: colors.text }]}>{withheld ? 'Not reliable for this clip' : `${metric.measured.low}–${metric.measured.high} ${unit}`}</Text></View><View style={{ flex: 1 }}><Text style={[typo.label, { color: colors.muted }]}>REFERENCE RANGE</Text><Text style={[typo.body, { color: colors.text }]}>{metric.normalRange ? `${metric.normalRange[0]}–${metric.normalRange[1]} ${unit}` : 'Not provided'}</Text></View></View>
      <Text style={[typo.caption, { color: colors.muted }]}>{withheld ? 'Try a clearer side-on view with your full body in frame. This reading is not used as a confirmed fault.' : 'Reference ranges depend on the running phase. A number outside a range is not a medical diagnosis.'}</Text>
    </View> : null}
  </View>;
}
