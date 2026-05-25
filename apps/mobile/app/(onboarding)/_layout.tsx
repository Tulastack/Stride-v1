import React from 'react';
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0B0D17' },
      }}
    >
      <Stack.Screen name="consent" />
      <Stack.Screen name="welcome" />
    </Stack>
  );
}
