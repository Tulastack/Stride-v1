import React from 'react';
import { View, Text, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { space, radius, type as typo } from '../theme';
import { Screen, TrackScene, Field, Button, Notice } from './primitives';
import { StrideLogo } from './StrideLogo';

export function AuthFrame({ register, email, password, setEmail, setPassword, loading, error, onSubmit, onAlternate }: {
  register?: boolean; email: string; password: string;
  setEmail: (value: string) => void; setPassword: (value: string) => void;
  loading: boolean; error: string; onSubmit: () => void; onAlternate: () => void;
}) {
  const { colors } = useTheme();
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}><Screen>
    <View style={styles.brand}><StrideLogo height={32} /></View>
    <View style={[styles.stage, { backgroundColor: colors.well }]}><View style={styles.stageCopy}><Text style={[typo.label, { color: colors.accent }]}>BUILT AROUND YOU</Text><Text style={[typo.display, { color: colors.wellText, marginTop: 12 }]}>A better stride.{'\n'}Starts here.</Text></View><TrackScene /></View>
    <View style={{ gap: space.lg }}><Text accessibilityRole="header" style={[typo.h2, { color: colors.text }]}>{register ? 'Join your coaching staff' : 'Welcome back'}</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field label="Email address" testID="email-input" editable={!loading} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" value={email} onChangeText={setEmail} />
      <Field label="Password" testID="password-input" editable={!loading} placeholder={register ? 'Choose a password' : 'Your password'} secureTextEntry autoCapitalize="none" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChangeText={setPassword} onSubmitEditing={onSubmit} returnKeyType="go" />
      <Button testID="auth-submit" label={register ? 'Create account' : 'Sign in'} loading={loading} onPress={onSubmit} />
      <Button testID="auth-alternate" label={register ? 'Already a member? Sign in' : 'New to Stride? Create an account'} variant="quiet" disabled={loading} onPress={onAlternate} />
    </View>
  </Screen></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ brand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, stage: { borderRadius: radius.lg, overflow: 'hidden' }, stageCopy: { padding: space.xl, paddingBottom: 0 } });
