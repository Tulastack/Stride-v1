import React, { useRef, useState } from 'react';

import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { supabase, isSupabaseConfigured } from '../../src/lib/supabase';
import { AuthFrame } from '../../src/ui/AuthFrame';

export default function LoginScreen() {
  const router = useRouter();
  const setToken = useStrideStore((state) => state.setToken);
  const setUser = useStrideStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submitLock = useRef(false);

  const handleLogin = async () => {
    if (submitLock.current) return;
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    submitLock.current = true;
    setLoading(true);
    setError('');

    try {
      if (isSupabaseConfigured && supabase) {
        // Real auth: exchange email/password for a Supabase JWT the API verifies.
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        const token = data.session?.access_token;
        if (!token) throw new Error('No session returned from Supabase');
        setToken(token);
        // Profile comes from the local API. If the Mac API is down / unreachable
        // (common when LAN IP drifts or ./scripts/dev-local.sh isn't running),
        // still let them in with a minimal profile so login isn't blocked.
        try {
          const profile = await strideApi.getProfile(token);
          setUser(profile);
          // Returning users who never completed consent go back through it.
          const needsConsent = profile?.consent_given_at == null || (profile?.consent_version ?? 0) < 1;
          router.replace(needsConsent ? '/(onboarding)/consent' : '/(tabs)');
        } catch (profileErr: any) {
          console.warn('getProfile after login failed:', profileErr?.message ?? profileErr);
          setUser({
            id: data.user?.id ?? 'unknown',
            email: data.user?.email ?? email,
            display_name: data.user?.user_metadata?.display_name ?? null,
            event_specialty: null,
            experience_level: null,
            personal_best_seconds: null,
          });
          router.replace('/(tabs)');
        }
        return;
      }

      setError('Backend not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  };

  return <AuthFrame email={email} password={password} setEmail={setEmail} setPassword={setPassword} loading={loading} error={error} onSubmit={handleLogin} onAlternate={() => router.push('/(auth)/register')} />;
}
