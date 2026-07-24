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
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';
import { TERMS_AND_CONDITIONS, PRIVACY_POLICY, type LegalDoc } from '../../src/content/legal';

function Checkbox({
  checked,
  onPress,
  testID,
  accent,
  accentText,
  border,
}: {
  checked: boolean;
  onPress: () => void;
  testID?: string;
  accent: string;
  accentText: string;
  border: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.checkbox, { borderColor: checked ? accent : border }, checked && { backgroundColor: accent }]}
      activeOpacity={0.7}
    >
      {checked && <Text style={[styles.checkmark, { color: accentText }]}>✓</Text>}
    </TouchableOpacity>
  );
}

export default function ConsentScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const setConsentGiven = useStrideStore((state) => state.setConsentGiven);
  const setDrillIntensityCap = useStrideStore((state) => state.setDrillIntensityCap);

  const [dob, setDob] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [medicalAccepted, setMedicalAccepted] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [parentalConsent, setParentalConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);

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
      // Consent MUST be recorded server-side — never proceed silently.
      Alert.alert('Could not save consent', err?.message || 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.brandName, { color: colors.text }]}>STRIDE</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Safety & Consent</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Please review and accept to continue</Text>

          {/* Date of Birth */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.muted }]}>Date of Birth (optional)</Text>
            <TextInput
              testID="dob-input"
              style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
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
              accent={colors.accent}
              accentText={colors.accentText}
              border={colors.border}
            />
            <Text style={[styles.checkboxLabel, { color: colors.text }]}>
              I accept the{' '}
              <Text
                testID="terms-link"
                style={[styles.linkText, { color: colors.accent }]}
                onPress={() => setLegalDoc(TERMS_AND_CONDITIONS)}
              >
                Terms & Conditions
              </Text>{' '}
              and{' '}
              <Text
                testID="privacy-link"
                style={[styles.linkText, { color: colors.accent }]}
                onPress={() => setLegalDoc(PRIVACY_POLICY)}
              >
                Privacy Policy
              </Text>
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
              accent={colors.accent}
              accentText={colors.accentText}
              border={colors.border}
            />
            <Text style={[styles.checkboxLabel, { color: colors.text }]}>
              I accept the Medical Disclaimer: Stride provides coaching insights only. Consult a
              physician before starting any new training program.
            </Text>
          </TouchableOpacity>

          {/* Minor Toggle */}
          <TouchableOpacity
            testID="minor-toggle"
            style={[
              styles.toggleRow,
              { backgroundColor: colors.cardAlt, borderColor: colors.border },
              isMinor && { borderColor: colors.accent, backgroundColor: colors.cardAlt },
            ]}
            onPress={() => {
              setIsMinor((v) => !v);
              if (isMinor) setParentalConsent(false);
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.toggleIndicator, { borderColor: colors.border }, isMinor && { backgroundColor: colors.accent, borderColor: colors.accent }]} />
            <Text style={[styles.toggleLabel, { color: colors.muted }, isMinor && { color: colors.accent }]}>
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
                accent={colors.accent}
                accentText={colors.accentText}
                border={colors.border}
              />
              <Text style={[styles.checkboxLabel, { color: colors.text }]}>
                A parent or guardian has reviewed and consents to my use of Stride.
              </Text>
            </TouchableOpacity>
          )}

          {/* Error */}
          {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

          {/* Continue Button */}
          <TouchableOpacity
            testID="consent-continue-btn"
            style={[
              styles.continueButton,
              { backgroundColor: colors.accent },
              !canContinue && { backgroundColor: colors.cardAlt },
            ]}
            onPress={handleContinue}
            disabled={!canContinue || loading}
            activeOpacity={0.8}
          >
            <Text style={[styles.continueButtonText, { color: canContinue ? colors.accentText : colors.muted }]}>
              {loading ? 'Saving...' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Legal document viewer (Terms / Privacy) */}
      <Modal visible={!!legalDoc} animationType="slide" transparent onRequestClose={() => setLegalDoc(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{legalDoc?.title}</Text>
              <TouchableOpacity testID="legal-close-btn" onPress={() => setLegalDoc(null)} hitSlop={12}>
                <Text style={[styles.modalClose, { color: colors.muted }]}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator>
              {legalDoc?.sections.map((section) => (
                <View key={section.heading} style={styles.legalSection}>
                  <Text style={[styles.legalHeading, { color: colors.text }]}>{section.heading}</Text>
                  <Text style={[styles.legalBody, { color: colors.muted }]}>{section.body}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  header: { alignItems: 'center', marginBottom: space.xxl },
  brandName: { fontSize: 40, fontWeight: '900', letterSpacing: 4 },
  card: { borderRadius: radius.md, padding: space.xl, borderWidth: 1 },
  title: { ...typo.display, fontSize: 26, marginBottom: space.xs },
  subtitle: { ...typo.body, marginBottom: space.xl },
  inputContainer: { marginBottom: space.xl },
  label: { ...typo.label, marginBottom: space.sm, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.lg },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkmark: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', lineHeight: 15 },
  checkboxLabel: { flex: 1, fontSize: 14, lineHeight: 21 },
  linkText: { fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.lg,
  },
  toggleIndicator: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5 },
  toggleLabel: { fontSize: 14, fontWeight: '700' },
  errorText: { ...typo.bodyMedium, marginBottom: space.lg },
  continueButton: { borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.xs },
  continueButtonText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '85%', padding: space.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalClose: { fontSize: 18, fontWeight: '700' },
  legalSection: { marginBottom: space.lg },
  legalHeading: { fontSize: 14, fontWeight: '800', marginBottom: space.xs },
  legalBody: { fontSize: 13, lineHeight: 19 },
});
