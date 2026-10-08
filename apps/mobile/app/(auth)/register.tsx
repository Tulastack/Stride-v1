import React, { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { supabase, isSupabaseConfigured } from '../../src/lib/supabase';
import { AuthFrame } from '../../src/ui/AuthFrame';
import { Screen, ScreenHeader, TrackScene, Button, Notice } from '../../src/ui';

export default function RegisterScreen() {
  const router = useRouter();
  const setToken = useStrideStore((state) => state.setToken);
  const setUser = useStrideStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmEmail, setConfirmEmail] = useState(false);
  const submitLock = useRef(false);

  const handleRegister = async () => {
    if (submitLock.current) return;
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    submitLock.current = true;
    setLoading(true);
    setError('');

    try {
      if (!isSupabaseConfigured || !supabase) {
        setError('Sign-up requires the backend to be configured');
        return;
      }

      // Real auth: create the account and exchange it for a Supabase JWT.
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) throw authError;

      const token = data.session?.access_token;
      if (!token) {
        // Email confirmation is enabled, no session until they confirm.
        setConfirmEmail(true);
        return;
      }

      setToken(token);
      // Profile comes from the local API. If it's unreachable, still let them
      // in with a minimal profile so registration isn't blocked (like login).
      try {
        const profile = await strideApi.getProfile(token);
        setUser(profile);
      } catch (profileErr: any) {
        console.warn('getProfile after sign-up failed:', profileErr?.message ?? profileErr);
        setUser({
          id: data.user?.id ?? 'unknown',
          email: data.user?.email ?? email,
          display_name: data.user?.user_metadata?.display_name ?? null,
          event_specialty: null,
          experience_level: null,
          personal_best_seconds: null,
        });
      }

      // Redirect to consent screen before onboarding flow
      router.replace('/(onboarding)/consent');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  };

  if (confirmEmail) return <Screen><ScreenHeader eyebrow="Account created" title="Check your inbox." subtitle={email} /><TrackScene compact /><Notice>Confirm your email using the link from Stride, then return to sign in. Your account is not signed in yet.</Notice><Button label="Back to sign in" onPress={() => router.replace('/(auth)/login')} /></Screen>;
  return <AuthFrame register email={email} password={password} setEmail={setEmail} setPassword={setPassword} loading={loading} error={error} onSubmit={handleRegister} onAlternate={() => router.push('/(auth)/login')} />;
}
