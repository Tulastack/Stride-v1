import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const setToken = useStrideStore((state) => state.setToken);
  const setUser = useStrideStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Mock registration
      const mockToken = 'mock_jwt_token_stripe_user';
      setToken(mockToken);
      setUser({
        id: 'new_athlete_uuid',
        email,
        display_name: null,
        event_specialty: null,
        experience_level: null,
        personal_best_seconds: null,
      });

      // Redirect to consent screen before onboarding flow
      router.replace('/(onboarding)/consent');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
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
          <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Start sprinting faster today</Text>

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

          <TouchableOpacity style={[styles.registerButton, { backgroundColor: colors.accent }]} onPress={handleRegister} disabled={loading}>
            <Text style={[styles.registerButtonText, { color: colors.accentText }]}>{loading ? 'Creating Account...' : 'Get Started'}</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.muted }]}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={[styles.loginLink, { color: colors.accent }]}>Sign In</Text>
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
  registerButton: { borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.sm },
  registerButtonText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: space.xl },
  footerText: { fontSize: 14 },
  loginLink: { fontSize: 14, fontWeight: '700' },
});
