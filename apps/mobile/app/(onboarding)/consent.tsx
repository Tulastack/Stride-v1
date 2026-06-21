import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';

function Checkbox({
  checked,
  onPress,
  testID,
}: {
  checked: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.checkbox, checked && styles.checkboxChecked]}
      activeOpacity={0.7}
    >
      {checked && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

export default function ConsentScreen() {
  const router = useRouter();
  const setConsentGiven = useStrideStore((state) => state.setConsentGiven);
  const setDrillIntensityCap = useStrideStore((state) => state.setDrillIntensityCap);

  const [dob, setDob] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [medicalAccepted, setMedicalAccepted] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [parentalConsent, setParentalConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canContinue = termsAccepted && medicalAccepted;

  const handleContinue = async () => {
    if (!canContinue) return;

    if (isMinor && !parentalConsent) {
      setError('Parental consent is required for users under 18');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await strideApi.giveConsent({
        consent_version: 1,
        date_of_birth: dob || undefined,
        parental_consent: isMinor ? parentalConsent : false,
      });

      setConsentGiven(true);

      if (response?.drill_intensity_cap) {
        setDrillIntensityCap(response.drill_intensity_cap);
      }

      router.replace('/(onboarding)/welcome');
    } catch (err: any) {
      // Offline fallback — still proceed
      setConsentGiven(true);
      router.replace('/(onboarding)/welcome');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.brandName}>STRIDE</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Safety & Consent</Text>
          <Text style={styles.subtitle}>Please review and accept to continue</Text>

          {/* Date of Birth */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Date of Birth (optional)</Text>
            <TextInput
              testID="dob-input"
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#5C6073"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              value={dob}
              onChangeText={setDob}
            />
          </View>

          {/* Terms & Conditions */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setTermsAccepted((v) => !v)}
            activeOpacity={0.8}
          >
            <Checkbox
              testID="terms-checkbox"
              checked={termsAccepted}
              onPress={() => setTermsAccepted((v) => !v)}
            />
            <Text style={styles.checkboxLabel}>
              I accept the{' '}
              <Text style={styles.linkText}>Terms & Conditions</Text> and{' '}
              <Text style={styles.linkText}>Privacy Policy</Text>
            </Text>
          </TouchableOpacity>

          {/* Medical Disclaimer */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setMedicalAccepted((v) => !v)}
            activeOpacity={0.8}
          >
            <Checkbox
              testID="medical-checkbox"
              checked={medicalAccepted}
              onPress={() => setMedicalAccepted((v) => !v)}
            />
            <Text style={styles.checkboxLabel}>
              I accept the Medical Disclaimer: Stride provides coaching insights only. Consult a
              physician before starting any new training program.
            </Text>
          </TouchableOpacity>

          {/* Minor Toggle */}
          <TouchableOpacity
            testID="minor-toggle"
            style={[styles.toggleRow, isMinor && styles.toggleRowActive]}
            onPress={() => {
              setIsMinor((v) => !v);
              if (isMinor) setParentalConsent(false);
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.toggleIndicator, isMinor && styles.toggleIndicatorActive]} />
            <Text style={[styles.toggleLabel, isMinor && { color: '#FF453A' }]}>
              I am under 18
            </Text>
          </TouchableOpacity>

          {/* Parental Consent (shown when minor) */}
          {isMinor && (
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setParentalConsent((v) => !v)}
              activeOpacity={0.8}
            >
              <Checkbox
                testID="parental-consent-checkbox"
                checked={parentalConsent}
                onPress={() => setParentalConsent((v) => !v)}
              />
              <Text style={styles.checkboxLabel}>
                A parent or guardian has reviewed and consents to my use of Stride.
              </Text>
            </TouchableOpacity>
          )}

          {/* Error */}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Continue Button */}
          <TouchableOpacity
            testID="consent-continue-btn"
            style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
            onPress={handleContinue}
            disabled={!canContinue || loading}
            activeOpacity={0.8}
          >
            <Text style={styles.continueButtonText}>
              {loading ? 'Saving...' : 'Continue'}
            </Text>
          </TouchableOpacity>
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
    marginBottom: 32,
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
  inputContainer: {
    marginBottom: 24,
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderColor: '#8E94A8',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: '#FF453A',
    borderColor: '#FF453A',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14,
  },
  checkboxLabel: {
    flex: 1,
    color: '#E4E6EB',
    fontSize: 14,
    lineHeight: 22,
  },
  linkText: {
    color: '#FF453A',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0F1122',
    borderWidth: 1,
    borderColor: '#262940',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  toggleRowActive: {
    borderColor: '#FF453A',
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  toggleIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#8E94A8',
    backgroundColor: 'transparent',
  },
  toggleIndicatorActive: {
    backgroundColor: '#FF453A',
    borderColor: '#FF453A',
  },
  toggleLabel: {
    color: '#8E94A8',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  continueButton: {
    backgroundColor: '#FF453A',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#FF453A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  continueButtonDisabled: {
    backgroundColor: '#3D1D1A',
    shadowOpacity: 0,
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
