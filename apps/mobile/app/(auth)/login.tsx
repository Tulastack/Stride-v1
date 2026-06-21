import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';

export default function LoginScreen() {
  const router = useRouter();
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
      // Simulate/mock Supabase authentication response
      // In production, we would use Supabase SDK: await supabase.auth.signInWithPassword({ email, password })
      const mockToken = 'mock_jwt_token_stripe_user';
      setToken(mockToken);

      // Fetch or create profile via API
      try {
        const profile = await strideApi.getProfile(mockToken);
        setUser(profile);
      } catch (profileErr) {
        // Fallback user if API is not fully running locally during development
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
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.brandName}>STRIDE</Text>
          <Text style={styles.tagline}>AI-Powered Sprint Coaching</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to analyze your sprint form</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="athlete@stride.ai"
              placeholderTextColor="#5C6073"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#5C6073"
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
            <Text style={styles.loginButtonText}>{loading ? 'Authenticating...' : 'Sign In'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.demoButton} onPress={handleQuickDemo}>
            <Text style={styles.demoButtonText}>Quick Demo Login (Bypass)</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text style={styles.registerLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0D17',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  brandName: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 6,
    textShadowColor: 'rgba(255, 69, 58, 0.4)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 15,
  },
  tagline: {
    fontSize: 16,
    color: '#8E94A8',
    marginTop: 8,
    fontWeight: '500',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#16192E',
    borderRadius: 12,
    padding: 32,
    borderWidth: 1,
    borderColor: '#262940',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E94A8',
    marginBottom: 24,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    color: '#8E94A8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#0F1122',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 16,
  },
  loginButton: {
    backgroundColor: '#FF453A',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: '#FF453A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  demoButton: {
    backgroundColor: '#1E254A',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  demoButtonText: {
    color: '#FF9F0A',
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    color: '#8E94A8',
    fontSize: 14,
  },
  registerLink: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
