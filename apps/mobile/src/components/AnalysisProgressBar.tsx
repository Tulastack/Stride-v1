import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { type as typo } from '../theme';

const LABELS: Record<string, string> = { queued: 'Queued', downloading: 'Downloading Video', pose_extraction: 'Extracting Pose', biomechanics_calculation: 'Calculating Angles', llm_structuring: 'Structuring Feedback', finalizing: 'Finalizing Report', complete: 'Complete!' };

export function AnalysisProgressBar({ currentStage, pct }: { currentStage: string; pct: number }) {
  const { colors } = useTheme();
  const value = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return <View testID="analysis-progress-bar" accessibilityLabel="analysis-progress-bar" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} style={{ gap: 12, width: '100%' }}><Text testID="progress-stage-label" accessibilityLabel="progress-stage-label" style={[typo.bodyMedium, { color: colors.text }]}>{LABELS[currentStage] ?? 'Processing'}</Text><View style={{ height: 3, backgroundColor: colors.border }}><View testID="progress-fill" style={{ width: `${value}%`, height: 3, backgroundColor: colors.goldInk }} /></View><Text style={[typo.caption, { color: colors.muted }]}>{value}%</Text></View>;
}
