import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const STAGES = [
  { key: 'queued', label: 'Queued', pct: 5 },
  { key: 'downloading', label: 'Downloading Video', pct: 15 },
  { key: 'pose_extraction', label: 'Extracting Pose', pct: 40 },
  { key: 'biomechanics_calculation', label: 'Calculating Angles', pct: 65 },
  { key: 'llm_structuring', label: 'Structuring Feedback', pct: 85 },
  { key: 'finalizing', label: 'Finalizing Report', pct: 95 },
  { key: 'complete', label: 'Complete!', pct: 100 },
];

interface Props {
  currentStage: string;
  pct: number;
}

export function AnalysisProgressBar({ currentStage, pct }: Props) {
  const stageInfo = STAGES.find(s => s.key === currentStage) ?? STAGES[0];

  return (
    <View style={styles.container} testID="analysis-progress-bar" accessibilityLabel="analysis-progress-bar">
      <Text style={styles.stageLabel} testID="progress-stage-label" accessibilityLabel="progress-stage-label">
        {stageInfo.label}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` as any }]} testID="progress-fill" />
      </View>
      <Text style={styles.pctText}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, width: '100%' },
  stageLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  track: { height: 6, backgroundColor: '#16192E', borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#FF453A', borderRadius: 3 },
  pctText: { color: '#8E94A8', fontSize: 12, alignSelf: 'flex-end' },
});
