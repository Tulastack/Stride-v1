import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { CoachChat } from '../../src/components/CoachChat';

export default function CoachScreen() {
  const { colors } = useTheme();
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <CoachChat analysisId={analysisId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 } });
