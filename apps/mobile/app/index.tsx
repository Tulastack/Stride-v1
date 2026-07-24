import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useStrideStore } from '../src/store/useStrideStore';
import { useTheme } from '../src/context/ThemeContext';

export default function IndexRedirect() {
  const token = useStrideStore((state) => state.token);
  const authHydrated = useStrideStore((state) => state.authHydrated);
  const { colors } = useTheme();

  // Wait for the initial getSession() to resolve before routing, so returning
  // users with a persisted session aren't bounced to the login screen.
  if (!authHydrated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // Use Redirect component instead of imperative navigation
  if (!token) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
