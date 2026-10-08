import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import type { Palette } from '../theme';
import { type as typo } from '../theme';
import { useTheme } from '../context/ThemeContext';

export interface CoachThinkingProps {
  steps: string[];
  colors: Palette;
  testID?: string;
}

export function CoachThinking({ steps, colors, testID = 'coach-thinking' }: CoachThinkingProps) {
  const { reduceMotion } = useTheme();
  if (!steps.length) return null;
  return (
    <View testID={testID} accessibilityLabel="Waiting for coach response" accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12 }}>
      {reduceMotion ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.goldInk }} />
        : <ActivityIndicator color={colors.goldInk} />}
      <Text style={[typo.caption, { color: colors.muted, flex: 1 }]}>{steps[steps.length - 1]}</Text>
    </View>
  );
}
