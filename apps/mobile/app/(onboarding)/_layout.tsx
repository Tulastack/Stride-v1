import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';

export default function OnboardingLayout() {
  const { colors, reduceMotion } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'slide_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="consent" />
      <Stack.Screen name="welcome" />
    </Stack>
  );
}
