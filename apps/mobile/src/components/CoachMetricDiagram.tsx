import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { space, radius, type as typo } from '../theme';

const LABELS: Record<string, { title: string; cue: string }> = {
  knee_drive: { title: 'Knee drive', cue: 'Thigh toward horizontal' },
  trunk_lean: { title: 'Trunk lean', cue: 'Slight forward lean from ankles' },
  hip_extension: { title: 'Hip extension', cue: 'Finish long behind you' },
  knee_flexion: { title: 'Knee flexion', cue: 'Heel recovers under glute' },
  overstride: { title: 'Foot strike', cue: 'Land under the hip' },
  arm_swing: { title: 'Arm swing', cue: 'Elbows back, not across' },
  contact_time_ms: { title: 'Ground contact', cue: 'Quick, springy contacts' },
  cadence_spm: { title: 'Cadence', cue: 'Quicker, lighter steps' },
  vertical_oscillation: { title: 'Vertical bounce', cue: 'Stay tall and flat' },
};

/** Compact sagittal stick-figure highlighting a metric — coach thread only. */
export function CoachMetricDiagram({
  metricKey,
  value,
  unit,
  normalRange,
}: {
  metricKey: string;
  value?: number;
  unit?: string;
  normalRange?: [number, number];
}) {
  const { colors } = useTheme();
  const meta = LABELS[metricKey] ?? { title: metricKey.replace(/_/g, ' '), cue: '' };
  const accent = colors.accent;
  const bone = colors.text;
  const muted = colors.muted;

  // Simple side-view runner: hip(40,70) knee(55,105) ankle(50,140) shoulder(38,40) head(38,22)
  const highlight =
    metricKey === 'knee_drive' || metricKey === 'knee_flexion' ? 'knee'
    : metricKey === 'trunk_lean' ? 'trunk'
    : metricKey === 'hip_extension' ? 'hip'
    : metricKey === 'overstride' ? 'foot'
    : metricKey === 'arm_swing' ? 'arm'
    : 'body';

  const stroke = (part: string) => (highlight === part || highlight === 'body' ? accent : bone);
  const sw = (part: string) => (highlight === part || highlight === 'body' ? 3 : 2);

  const inRange =
    value != null && normalRange
      ? value >= normalRange[0] && value <= normalRange[1]
      : null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.row}>
        <Svg width={88} height={150} viewBox="0 0 90 155">
          {/* head */}
          <Circle cx={38} cy={18} r={8} stroke={stroke('trunk')} strokeWidth={sw('trunk')} fill="none" />
          {/* trunk */}
          <Line x1={38} y1={26} x2={40} y2={70} stroke={stroke('trunk')} strokeWidth={sw('trunk')} strokeLinecap="round" />
          {/* rear leg (support) */}
          <Line x1={40} y1={70} x2={22} y2={110} stroke={bone} strokeWidth={2} strokeLinecap="round" />
          <Line x1={22} y1={110} x2={18} y2={145} stroke={bone} strokeWidth={2} strokeLinecap="round" />
          {/* drive leg */}
          <Line x1={40} y1={70} x2={62} y2={95} stroke={stroke('hip')} strokeWidth={sw('hip')} strokeLinecap="round" />
          <Line x1={62} y1={95} x2={58} y2={130} stroke={stroke('knee')} strokeWidth={sw('knee')} strokeLinecap="round" />
          <Line x1={58} y1={130} x2={70} y2={138} stroke={stroke('foot')} strokeWidth={sw('foot')} strokeLinecap="round" />
          {/* arm */}
          <Line x1={38} y1={40} x2={58} y2={55} stroke={stroke('arm')} strokeWidth={sw('arm')} strokeLinecap="round" />
          <Line x1={58} y1={55} x2={52} y2={78} stroke={stroke('arm')} strokeWidth={sw('arm')} strokeLinecap="round" />
          {/* ground */}
          <Path d="M8 148 H82" stroke={muted} strokeWidth={1} strokeOpacity={0.5} />
          {value != null && (
            <SvgText x={45} y={12} fill={accent} fontSize={10} fontWeight="700" textAnchor="middle">
              {`${Math.round(value)}${unit === 'deg' || unit === '°' ? '°' : unit === 'ms' ? 'ms' : ''}`}
            </SvgText>
          )}
        </Svg>
        <View style={styles.copy}>
          <Text style={[typo.label, { color: muted }]}>{meta.title.toUpperCase()}</Text>
          {meta.cue ? <Text style={[styles.cue, { color: colors.text }]}>{meta.cue}</Text> : null}
          {normalRange ? (
            <Text style={[styles.range, { color: muted }]}>
              Target {normalRange[0]}–{normalRange[1]}{unit === 'deg' ? '°' : unit ? ` ${unit}` : ''}
              {inRange === false ? ' · off target' : inRange ? ' · in range' : ''}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.sm,
    maxWidth: '92%',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  copy: { flex: 1, gap: 4 },
  cue: { fontSize: 14, fontWeight: '500', lineHeight: 19 },
  range: { fontSize: 12, marginTop: 2 },
});
