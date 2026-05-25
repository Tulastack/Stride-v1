import React from 'react';
import { Redirect } from 'expo-router';
import { useStrideStore } from '../src/store/useStrideStore';

export default function IndexRedirect() {
  const token = useStrideStore((state) => state.token);

  // Use Redirect component instead of imperative navigation
  if (!token) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(tabs)" />;
}
