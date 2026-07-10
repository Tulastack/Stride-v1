import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useTheme } from '../../src/context/ThemeContext';
import { CoachChat } from '../../src/components/CoachChat';

export default function CoachScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <CoachChat />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 } });
