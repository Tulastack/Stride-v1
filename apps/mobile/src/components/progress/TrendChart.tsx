import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import { space, type as typo } from '../../theme';

interface TrendChartProps {
  title: string; unit?: string; points: number[]; labels?: string[];
  color?: string; mutedColor?: string; cardColor?: string; borderColor?: string; textColor?: string;
}

export function TrendChart({ title, unit = '', points, labels, color, textColor }: TrendChartProps) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const accent = color ?? colors.goldInk;
  const index = selected == null ? points.length - 1 : Math.min(selected, points.length - 1);
  if (!points.length) return <Text style={[typo.caption, { color: colors.muted }]}>No measured trend yet</Text>;
  const min = Math.min(...points), max = Math.max(...points);
  const padding = Math.max((max - min) * 0.2, 1), range = max - min + padding * 2;
  const coordinates = points.map((value, position) => ({ x: 12 + position / Math.max(points.length - 1, 1) * 296, y: 154 - (value - min + padding) / range * 130 }));
  const path = coordinates.map((point, position) => `${position ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const fill = path + `L${coordinates[coordinates.length - 1].x},172 L${coordinates[0].x},172 Z`;
  return <View style={{ gap: space.sm }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}><Text style={[typo.caption, { color: colors.muted }]}>{title}</Text><Text style={[typo.h2, { color: textColor ?? colors.text, fontVariant: ['tabular-nums'] }]}>{points[index]}{unit}</Text></View>
    <Pressable accessibilityRole="adjustable" accessibilityLabel={title + ' chart'} accessibilityValue={{ text: `${labels?.[index] ?? 'Session ' + (index + 1)}: ${points[index]}${unit}` }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(event) => setSelected(Math.max(0, Math.min(points.length - 1, index + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} onPress={(event) => { if (width) setSelected(Math.max(0, Math.min(points.length - 1, Math.round(event.nativeEvent.locationX / width * (points.length - 1))))); }}>
      <Svg width="100%" height={184} viewBox="0 0 320 184"><Defs><LinearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={accent} stopOpacity="0.22" /><Stop offset="1" stopColor={accent} stopOpacity="0" /></LinearGradient></Defs>{[24, 90, 154].map((height) => <Line key={height} x1={12} x2={308} y1={height} y2={height} stroke={colors.border} strokeWidth={0.5} />)}<Path d={fill} fill="url(#historyFill)" /><Path d={path} stroke={accent} strokeWidth={2} fill="none" /><Line x1={coordinates[index].x} x2={coordinates[index].x} y1="16" y2="174" stroke={colors.muted} strokeWidth={0.5} strokeDasharray="3 4" />{coordinates.map((point, position) => <Circle key={position} cx={point.x} cy={point.y} r={position === index ? 4 : 2} fill={accent} />)}</Svg>
    </Pressable>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[typo.tiny, { color: colors.muted }]}>{labels?.[0] ?? 'First session'}</Text><Text style={[typo.caption, { color: colors.goldInk }]}>{labels?.[index] ?? `Session ${index + 1}`}</Text><Text style={[typo.tiny, { color: colors.muted }]}>{labels?.[points.length - 1] ?? 'Latest'}</Text></View>
  </View>;
}
