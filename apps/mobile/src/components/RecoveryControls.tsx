import React from 'react';
import { View, Text, Switch } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { type as typo } from '../theme';
import { Button, Notice } from '../ui';
import type { useRecoveryStatus } from '../hooks/useRecoveryStatus';

export function RecoveryControls({ recovery }: { recovery: ReturnType<typeof useRecoveryStatus> }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', minHeight: 64 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[typo.bodyMedium, { color: colors.text }]}>I am injured today</Text>
          <Text style={[typo.caption, { color: colors.muted }]}>Pause sprint prescriptions. This is not a medical assessment.</Text>
        </View>
        <Switch testID="injury-toggle" accessibilityLabel="I am injured today"
          disabled={!recovery.ready || recovery.busy} value={recovery.isInjured}
          onValueChange={recovery.toggle} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.card} />
      </View>
      {recovery.isInjured ? (
        <View testID="recovery-mode-notice">
          <Notice>Recovery Mode. Sprint drills are paused. Do not train through pain; follow guidance from a qualified health professional.</Notice>
        </View>
      ) : !recovery.ready && !recovery.error ? <Notice>Checking your recovery preference before offering sprint practice…</Notice> : null}
      {recovery.error ? <><Notice tone="error">{recovery.error}</Notice><Button label="Refresh recovery preference" variant="secondary" onPress={recovery.refresh} /></> : null}
    </View>
  );
}
