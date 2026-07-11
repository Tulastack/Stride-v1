import React, { useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { space, radius } from '../../theme';

interface TrendChartProps {
  title: string;
  unit?: string;
  points: number[];
  color: string;
  mutedColor: string;
  cardColor: string;
  borderColor: string;
  textColor: string;
}

const CHART_HEIGHT = 96;
const PAD = 12;

/** A small hand-rolled SVG line chart — the app has no charting library, so
 * this follows the same pattern as the hand-rolled skeleton overlays in
 * PoseSnapshot/PoseVideoPlayer rather than adding a new dependency. */
export function TrendChart({ title, unit, points, color, mutedColor, cardColor, borderColor, textColor }: TrendChartProps) {
  const [width, setWidth] = useState(0);

  if (points.length < 2) {
    return (
      <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        <Text style={[styles.empty, { color: mutedColor }]}>Not enough data yet</Text>
      </View>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = width - PAD * 2;
  const h = CHART_HEIGHT - PAD * 2;

  const coords = points.map((v, i) => {
    const x = PAD + (i / (points.length - 1)) * w;
    const y = PAD + h - ((v - min) / range) * h;
    return { x, y };
  });
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last - first;

  return (
    <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        <Text style={[styles.delta, { color: delta === 0 ? mutedColor : delta > 0 ? '#2E8F63' : '#C1432B' }]}>
          {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}{unit ?? ''}
        </Text>
      </View>
      <View style={{ height: CHART_HEIGHT }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            <Polyline points={linePoints} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {coords.map((c, i) => (
              <Circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 3.5 : 2} fill={color} />
            ))}
          </Svg>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderWidth: 1, borderRadius: radius.md, marginBottom: space.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  title: { fontSize: 13, fontWeight: '700' },
  delta: { fontSize: 13, fontWeight: '800' },
  empty: { fontSize: 12, paddingVertical: space.md },
});
