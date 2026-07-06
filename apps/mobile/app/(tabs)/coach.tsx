import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { CoachChat } from '../../src/components/CoachChat';

export default function CoachScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <CoachChat />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
});
