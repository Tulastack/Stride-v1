import React from 'react';
import { View, Text } from 'react-native';
import { type Palette, type as typo } from '../../theme';

export interface StreakBadgeProps { value: number; atRisk?: boolean; colors: Palette; celebrateKey?: number; testID?: string }
export function StreakBadge({ value, atRisk, colors, testID }: StreakBadgeProps) {
  return <View testID={testID} accessibilityLabel={`${value}-day streak${atRisk ? ', today still open' : ''}`} style={{ alignItems: 'flex-end', gap: 3 }}><Text style={[typo.h2, { color: colors.goldInk, fontVariant: ['tabular-nums'] }]}>{value}<Text style={typo.caption}> days</Text></Text><Text style={[typo.tiny, { color: colors.muted }]}>{atRisk ? 'Today still open' : 'Training streak'}</Text></View>;
}
