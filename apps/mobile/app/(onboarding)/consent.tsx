import React, { useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Check, ShieldCheck } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';
import { Screen, ScreenHeader, Field, Button, Notice } from '../../src/ui';
import { LegalReader } from '../../src/components/LegalReader';
import { TERMS_AND_CONDITIONS, PRIVACY_POLICY, type LegalDoc } from '../../src/content/legal';

function ConsentRow({ checked, onPress, testID, children }: { checked: boolean; onPress: () => void; testID: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={{ flexDirection: 'row', gap: 14, paddingVertical: 18, borderBottomWidth: 0.5, borderColor: colors.border, alignItems: 'flex-start' }}>
    <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: checked ? colors.goldInk : colors.muted, backgroundColor: checked ? colors.accent : colors.transparent, alignItems: 'center', justifyContent: 'center' }}>{checked ? <Check size={16} color={colors.accentText} /> : null}</View>
    <Text style={[typo.body, { color: colors.text, flex: 1 }]}>{children}</Text>
  </Pressable>;
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
  const handleContinue = async () => {
    if (!termsAccepted || !medicalAccepted || loading) return;
    if (isMinor && !parentalConsent) { setError('Parental consent is required for users under 18'); return; }
    setError(''); setLoading(true);
    try {
      const response = await strideApi.giveConsent({ consent_version: 1, date_of_birth: dob || undefined, parental_consent: isMinor ? parentalConsent : false });
      setConsentGiven(true);
      if (response?.drill_intensity_cap) setDrillIntensityCap(response.drill_intensity_cap);
      router.replace('/(onboarding)/welcome');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save consent. Check your connection and try again.'); }
    finally { setLoading(false); }
  };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}><Screen>
    <ScreenHeader eyebrow="Before your first stride" title="Train with confidence." subtitle="Your safety and your data come first." />
    <View style={{ backgroundColor: colors.sage, padding: space.xl, borderRadius: radius.md, gap: 12 }}><ShieldCheck color={colors.sageInk} size={28} /><Text style={[typo.h2, { color: colors.text }]}>Coaching. Not a diagnosis.</Text><Text style={[typo.body, { color: colors.muted }]}>Stride helps you understand movement. Consult a physician before starting a new training program, and stop if you feel pain.</Text></View>
    <Field label="Date of birth / optional" testID="dob-input" placeholder="YYYY-MM-DD" autoCapitalize="none" value={dob} onChangeText={setDob} />
    <View><ConsentRow testID="terms-checkbox" checked={termsAccepted} onPress={() => setTermsAccepted(!termsAccepted)}>I accept the Terms & Conditions and Privacy Policy.</ConsentRow><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}><Button label="Terms & Conditions" testID="terms-link" variant="quiet" onPress={() => setLegalDoc(TERMS_AND_CONDITIONS)} /><Button label="Privacy Policy" testID="privacy-link" variant="quiet" onPress={() => setLegalDoc(PRIVACY_POLICY)} /></View>
    <ConsentRow testID="medical-checkbox" checked={medicalAccepted} onPress={() => setMedicalAccepted(!medicalAccepted)}>I understand the Medical Disclaimer. These insights do not replace qualified medical advice.</ConsentRow>
    <ConsentRow testID="minor-toggle" checked={isMinor} onPress={() => { setIsMinor(!isMinor); setParentalConsent(false); }}>I am under 18</ConsentRow>
    {isMinor ? <ConsentRow testID="parental-consent-checkbox" checked={parentalConsent} onPress={() => setParentalConsent(!parentalConsent)}>A parent or guardian has reviewed and consents to my use of Stride.</ConsentRow> : null}</View>
    {error ? <Notice tone="error">{error}</Notice> : null}
    <Button label="Accept & continue" testID="consent-continue-btn" disabled={!termsAccepted || !medicalAccepted} loading={loading} onPress={handleContinue} />
    <LegalReader document={legalDoc} onClose={() => setLegalDoc(null)} />
  </Screen></KeyboardAvoidingView>;
}
