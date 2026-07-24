import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { useStrideStore } from '../src/store/useStrideStore';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function InnerLayout() {
  const setToken = useStrideStore((s) => s.setToken);
  const setUser = useStrideStore((s) => s.setUser);
  const setAuthHydrated = useStrideStore((s) => s.setAuthHydrated);
  const { colors, mode } = useTheme();

  useEffect(() => {
    if (!supabase) {
      // No Supabase configured — nothing to restore, unblock the index gate.
      setAuthHydrated(true);
      return;
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        const session = data.session;
        if (!session?.access_token) return;
        setToken(session.access_token);
        // Minimal profile from the restored session so screens aren't blank;
        // the API profile replaces it after the next login/profile fetch.
        if (!useStrideStore.getState().user && session.user) {
          setUser({
            id: session.user.id,
            email: session.user.email ?? '',
            display_name: session.user.user_metadata?.display_name ?? null,
            event_specialty: null,
            experience_level: null,
            personal_best_seconds: null,
          });
        }
      })
      .catch(() => {})
      .finally(() => setAuthHydrated(true));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Explicitly drop the token so a refresh can't resurrect the session.
        setToken(null);
        return;
      }
      setToken(session?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [setToken, setUser, setAuthHydrated]);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(onboarding)" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <InnerLayout />
        </SafeAreaProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
