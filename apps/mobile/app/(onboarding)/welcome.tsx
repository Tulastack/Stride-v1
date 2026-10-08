import React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, ScreenHeader, Notice } from '../../src/ui';
import { AthleteProfile } from '../../src/components/AthleteProfile';

export default function OnboardingScreen() {
  const router = useRouter();
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}><Screen>
    <ScreenHeader eyebrow="Your athlete profile" title="Make it personal." subtitle="A little context for your coaching staff." />
    <AthleteProfile onComplete={() => router.replace('/(tabs)')} />
    <Notice>Your profile guides coaching. Your video is still the source of each measurement.</Notice>
  </Screen></KeyboardAvoidingView>;
}
