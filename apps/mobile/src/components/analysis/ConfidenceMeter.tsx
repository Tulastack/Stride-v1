import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { type as typo } from '../../theme';
import { confidenceTier } from '../../types/analysis';

export function ConfidenceMeter({ confidence, testID }: { confidence: number; testID?: string }) {
  const { colors } = useTheme();
  const value = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0));
  const tier = confidenceTier(value);
  return <View testID={testID} accessibilityLabel={`confidence-${tier}`} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={{ width: 64, height: 3, backgroundColor: colors.border }}><View style={{ width: `${value * 100}%`, height: 3, backgroundColor: tier === 'low' ? colors.muted : colors.goldInk }} /></View><Text style={[typo.caption, { color: colors.muted, fontVariant: ['tabular-nums'] }]}>{Math.round(value * 100)}% confidence</Text></View>;
}
