import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';

export default function OnboardingScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useStrideStore((state) => state.user);
  const setUser = useStrideStore((state) => state.setUser);

  const [displayName, setDisplayName] = useState('');
  const [eventSpecialty, setEventSpecialty] = useState<'100m' | '200m' | '400m' | null>(null);
  const [experienceLevel, setExperienceLevel] = useState<'beginner' | 'intermediate' | 'advanced' | null>(null);
  const [pb, setPb] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCompleteOnboarding = async () => {
    if (!displayName || !eventSpecialty || !experienceLevel) {
      setError('Please complete all fields (Personal Best is optional)');
      return;
    }

    setLoading(true);
    setError('');

    const pbSeconds = pb ? parseFloat(pb) : undefined;

    try {
      // Update on API server
      let updatedUser = null;
      try {
        updatedUser = await strideApi.updateProfile({
          displayName,
          eventSpecialty,
          experienceLevel,
          personalBestSeconds: pbSeconds,
        });
      } catch (apiErr) {
        // Fallback for offline local development
        updatedUser = {
          ...user,
          display_name: displayName,
          event_specialty: eventSpecialty,
          experience_level: experienceLevel,
          personal_best_seconds: pbSeconds ?? null,
        };
      }

      setUser(updatedUser);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
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
        <Text style={[styles.title, { color: colors.text }]}>Athlete Profile</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Help Stride Coach customize your biomechanical feedback</Text>

        {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

        {/* Display Name Input */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>What should we call you?</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder="e.g. Adhiban"
            placeholderTextColor={colors.muted}
            value={displayName}
            onChangeText={setDisplayName}
          />
        </View>

        {/* Event Specialty */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>Select your primary event specialty</Text>
          <View style={styles.buttonRow}>
            {(['100m', '200m', '400m'] as const).map((spec) => (
              <TouchableOpacity
                key={spec}
                style={[
                  styles.optionButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  eventSpecialty === spec && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                onPress={() => setEventSpecialty(spec)}
              >
                <Text style={[styles.optionText, { color: colors.muted }, eventSpecialty === spec && { color: colors.accentText }]}>
                  {spec}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Experience Level */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>What is your experience level?</Text>
          <View style={styles.buttonRow}>
            {(['beginner', 'intermediate', 'advanced'] as const).map((level) => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.optionButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  experienceLevel === level && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                onPress={() => setExperienceLevel(level)}
              >
                <Text style={[styles.optionText, { color: colors.muted }, experienceLevel === level && { color: colors.accentText }]}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Personal Best */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>Personal Best (Seconds - Optional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder="e.g. 10.85"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            value={pb}
            onChangeText={setPb}
          />
        </View>

        <TouchableOpacity style={[styles.completeButton, { backgroundColor: colors.accent }]} onPress={handleCompleteOnboarding} disabled={loading}>
          <Text style={[styles.completeButtonText, { color: colors.accentText }]}>{loading ? 'Saving Profile...' : 'Finish Setup'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContainer: { flexGrow: 1, padding: space.xl, justifyContent: 'center' },
  title: { ...typo.display, fontSize: 30, marginBottom: space.xs },
  subtitle: { ...typo.body, marginBottom: space.xxl, lineHeight: 22 },
  errorText: { ...typo.bodyMedium, marginBottom: space.xl },
  section: { marginBottom: space.xxl },
  label: { fontSize: 16, fontWeight: '600', marginBottom: space.md },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  optionButton: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  optionText: { fontSize: 14, fontWeight: '700' },
  completeButton: { borderRadius: radius.md, paddingVertical: space.lg + 2, alignItems: 'center', marginTop: space.lg },
  completeButtonText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
});
