import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';

export default function OnboardingScreen() {
  const router = useRouter();
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
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Athlete Profile</Text>
        <Text style={styles.subtitle}>Help Stride Coach customize your biomechanical feedback</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Display Name Input */}
        <View style={styles.section}>
          <Text style={styles.label}>What should we call you?</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Adhiban"
            placeholderTextColor="#5C6073"
            value={displayName}
            onChangeText={setDisplayName}
          />
        </View>

        {/* Event Specialty */}
        <View style={styles.section}>
          <Text style={styles.label}>Select your primary event specialty</Text>
          <View style={styles.buttonRow}>
            {(['100m', '200m', '400m'] as const).map((spec) => (
              <TouchableOpacity
                key={spec}
                style={[
                  styles.optionButton,
                  eventSpecialty === spec ? styles.activeOption : null,
                ]}
                onPress={() => setEventSpecialty(spec)}
              >
                <Text style={[styles.optionText, eventSpecialty === spec ? styles.activeOptionText : null]}>
                  {spec}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Experience Level */}
        <View style={styles.section}>
          <Text style={styles.label}>What is your experience level?</Text>
          <View style={styles.buttonRow}>
            {(['beginner', 'intermediate', 'advanced'] as const).map((level) => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.optionButton,
                  experienceLevel === level ? styles.activeOption : null,
                ]}
                onPress={() => setExperienceLevel(level)}
              >
                <Text style={[styles.optionText, experienceLevel === level ? styles.activeOptionText : null]}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Personal Best */}
        <View style={styles.section}>
          <Text style={styles.label}>Personal Best (Seconds - Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 10.85"
            placeholderTextColor="#5C6073"
            keyboardType="decimal-pad"
            value={pb}
            onChangeText={setPb}
          />
        </View>

        <TouchableOpacity style={styles.completeButton} onPress={handleCompleteOnboarding} disabled={loading}>
          <Text style={styles.completeButtonText}>{loading ? 'Saving Profile...' : 'Finish Setup'}</Text>
        </TouchableOpacity>
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
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E94A8',
    marginBottom: 32,
    lineHeight: 22,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 20,
  },
  section: {
    marginBottom: 28,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#16192E',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  optionButton: {
    flex: 1,
    backgroundColor: '#16192E',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activeOption: {
    backgroundColor: '#FF453A',
    borderColor: '#FF453A',
  },
  optionText: {
    color: '#8E94A8',
    fontSize: 14,
    fontWeight: '700',
  },
  activeOptionText: {
    color: '#FFFFFF',
  },
  completeButton: {
    backgroundColor: '#FF453A',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#FF453A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  completeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
