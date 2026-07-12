import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { supabase, isSupabaseConfigured } from '../../src/lib/supabase';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const setToken = useStrideStore((state) => state.setToken);
  const setUser = useStrideStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

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
        const profile = await strideApi.getProfile(token);
        setUser(profile);
        router.replace('/(tabs)');
        return;
      }

      // No Supabase configured — dev/demo fallback (UI exploration only).
      const mockToken = 'mock_jwt_token_stripe_user';
      setToken(mockToken);
      try {
        const profile = await strideApi.getProfile(mockToken);
        setUser(profile);
      } catch (profileErr) {
        setUser({
          id: 'dev_user_uuid',
          email,
          display_name: 'Solo Sprinter',
          event_specialty: '100m',
          experience_level: 'intermediate',
          personal_best_seconds: 10.85,
        });
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = () => {
    // Quick demo login to easily bypass auth setup during testing
    setToken('mock_jwt_token_stripe_user');
    setUser({
      id: 'demo_athlete_uuid',
      email: 'demo@stride.ai',
      display_name: 'Usain Bolt Jr.',
      event_specialty: '100m',
      experience_level: 'advanced',
      personal_best_seconds: 9.81,
    });
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={[styles.brandName, { color: colors.text }]}>STRIDE</Text>
          <Text style={[styles.tagline, { color: colors.muted }]}>AI-Powered Sprint Coaching</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Sign in to analyze your sprint form</Text>

          {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.muted }]}>Email Address</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder="athlete@stride.ai"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.muted }]}>Password</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity style={[styles.loginButton, { backgroundColor: colors.accent }]} onPress={handleLogin} disabled={loading}>
            <Text style={[styles.loginButtonText, { color: colors.accentText }]}>{loading ? 'Authenticating...' : 'Sign In'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.demoButton, { borderColor: colors.border }]} onPress={handleQuickDemo}>
            <Text style={[styles.demoButtonText, { color: colors.accent }]}>Quick Demo Login (Bypass)</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.muted }]}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text style={[styles.registerLink, { color: colors.accent }]}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  header: { alignItems: 'center', marginBottom: space.xxxl },
  brandName: { fontSize: 40, fontWeight: '900', letterSpacing: 4 },
  tagline: { ...typo.body, marginTop: space.sm, letterSpacing: 0.5 },
  card: { borderRadius: radius.md, padding: space.xl, borderWidth: 1 },
  title: { ...typo.display, fontSize: 26, marginBottom: space.xs },
  subtitle: { ...typo.body, marginBottom: space.xl },
  errorText: { ...typo.bodyMedium, marginBottom: space.lg },
  inputContainer: { marginBottom: space.lg },
  label: { ...typo.label, marginBottom: space.sm, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  loginButton: { borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.sm },
  loginButtonText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  demoButton: { borderWidth: 1, borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center', marginTop: space.lg },
  demoButtonText: { fontSize: 14, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: space.xl },
  footerText: { fontSize: 14 },
  registerLink: { fontSize: 14, fontWeight: '700' },
});
