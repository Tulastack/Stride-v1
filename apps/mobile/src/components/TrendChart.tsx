// Minimal per-metric trend chart (PROMPT F.5 "Your trend" + F.6 Progress).
// Shaded normalRange band, line across uploads, PB marker in signal color, and a
// per-point confidence dot (muted when low) so a noisy point isn't mistaken for
// a real regression.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Polyline, Circle, Line } from 'react-native-svg';
import { semantic, spacing, radius, borderWidth, typography } from '../ui/theme';
import { confidenceTier, metricLabel } from '../types/analysis';
import type { MetricPoint } from '../lib/briefing';

const W = 300;
const H = 120;
const PAD = 8;

export function TrendChart({
  series,
  pbIndex,
  testID,
}: {
  series: MetricPoint[];
  pbIndex?: number;
  testID?: string;
}) {
  if (series.length === 0) return null;
  const key = series[0].metric.key;
  const unit = series[0].metric.unit;
  const nr = series[0].metric.normalRange;

  const values = series.map((p) => p.metric.measured.value);
  const lows = series.map((p) => p.metric.measured.low);
  const highs = series.map((p) => p.metric.measured.high);
  const min = Math.min(...lows, ...(nr ? [nr[0]] : []));
  const max = Math.max(...highs, ...(nr ? [nr[1]] : []));
  const span = Math.max(max - min, 1);

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(series.length - 1, 1);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

  const points = series.map((p, i) => `${x(i)},${y(p.metric.measured.value)}`).join(' ');

  return (
    <View style={styles.card} testID={testID} accessibilityLabel={`trend-${key}`}>
      <Text style={styles.title}>{metricLabel(key)} · {unit}</Text>
      <Svg width={W} height={H}>
        {nr ? (
          <Rect x={PAD} y={y(nr[1])} width={W - 2 * PAD} height={Math.abs(y(nr[0]) - y(nr[1]))} fill={semantic.status.improve} opacity={0.12} />
        ) : null}
        {nr ? <Line x1={PAD} y1={y((nr[0] + nr[1]) / 2)} x2={W - PAD} y2={y((nr[0] + nr[1]) / 2)} stroke={semantic.status.improve} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} /> : null}
        <Polyline points={points} fill="none" stroke={semantic.text.secondary} strokeWidth={2} />
        {series.map((p, i) => {
          const low = confidenceTier(p.metric.measured.confidence) === 'low';
          const isPb = i === pbIndex;
          return (
            <Circle
              key={i}
              cx={x(i)}
              cy={y(p.metric.measured.value)}
              r={isPb ? 6 : 4}
              fill={isPb ? semantic.status.pr : low ? semantic.text.muted : semantic.text.primary}
            />
          );
        })}
      </Svg>
      <Text style={styles.caption}>
        {series.length} upload{series.length > 1 ? 's' : ''} · band shaded · PB in volt
      </Text>
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
  title: { ...(typography.bodyStrong as object), color: semantic.text.primary },
  caption: { ...(typography.caption as object), color: semantic.text.muted },
});
