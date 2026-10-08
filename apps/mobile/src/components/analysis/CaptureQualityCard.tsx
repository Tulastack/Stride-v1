import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { type as typo, space } from '../../theme';
import type { CaptureQuality } from '../../types/analysis';
import { Notice, SectionTitle } from '../../ui';

export function CaptureQualityCard({ capture, testID }: { capture: CaptureQuality; testID?: string }) {
  const { colors } = useTheme();
  const usable = Object.values(capture.perMetricUsable ?? {}).filter(Boolean).length;
  const total = Object.keys(capture.perMetricUsable ?? {}).length;
  return <View testID={testID} accessibilityLabel="capture-quality-card" style={{ gap: space.md }}><SectionTitle>About this footage</SectionTitle><Text style={[typo.caption, { color: colors.muted }]}>{capture.fps} fps · {capture.framing === 'full' ? 'Full-body framing' : 'Partial framing'} · {capture.motionBlur} motion blur</Text><Notice>{capture.primaryNudge || (total ? `${usable} of ${total} readings pass the capture-quality check. Each metric still has its own confidence.` : 'Capture quality does not guarantee the reliability of every metric.')}</Notice></View>;
}
