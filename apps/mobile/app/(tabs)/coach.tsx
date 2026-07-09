import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { CoachChat } from '../../src/components/CoachChat';

export default function CoachScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <CoachChat />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0E0F12' },
});
