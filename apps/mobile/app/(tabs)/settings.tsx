import React, { useState } from 'react';
import { View, Text, Pressable, Switch } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useTheme } from '../../src/context/ThemeContext';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { supabase } from '../../src/lib/supabase';
import { space, radius, type as typo } from '../../src/theme';
import { Screen, ScreenHeader, SectionTitle, SegmentedControl, Button, Sheet, SheetScroll, Notice, StrideLogo } from '../../src/ui';
import { LegalReader } from '../../src/components/LegalReader';
import { AthleteProfile } from '../../src/components/AthleteProfile';
import { RecoveryControls } from '../../src/components/RecoveryControls';
import { useRecoveryStatus } from '../../src/hooks/useRecoveryStatus';
import { TERMS_AND_CONDITIONS, PRIVACY_POLICY, type LegalDoc } from '../../src/content/legal';

export default function SettingsScreen() {
  const { colors, appearance, setAppearance, reduceMotion, setReduceMotion } = useTheme();
  const router = useRouter();
  const user = useStrideStore((state) => state.user);
  const logout = useStrideStore((state) => state.logout);
  const recovery = useRecoveryStatus();
  const [confirm, setConfirm] = useState<'logout' | 'delete' | null>(null);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const [profile, setProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = async () => {
    if (!confirm || busy) return;
    setBusy(true); setError('');
    try {
      if (confirm === 'delete') {
        await strideApi.deleteAccount();
        await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
      } else {
        const response = await supabase?.auth.signOut();
        if (response?.error) throw response.error;
      }
      logout(); setConfirm(null); router.replace('/(auth)/login');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not finish. Please try again.'); }
    finally { setBusy(false); }
  };
  const row = (title: string, subtitle: string, onPress: () => void, destructive = false) => <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 64, paddingVertical: 12, borderBottomWidth: 0.5, borderColor: colors.border }}><View style={{ flex: 1 }}><Text style={[typo.bodyMedium, { color: destructive ? colors.error : colors.text }]}>{title}</Text>{subtitle ? <Text style={[typo.caption, { color: colors.muted }]}>{subtitle}</Text> : null}</View><ChevronRight size={16} color={colors.muted} /></Pressable>;
  return <Screen>
    <ScreenHeader logo title="Settings." />
    <Pressable accessibilityRole="button" accessibilityLabel="Edit athlete profile" onPress={() => setProfile(true)} style={{ flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 12 }}><View style={{ width: 54, height: 54, borderRadius: radius.pill, backgroundColor: colors.champagne, justifyContent: 'center', alignItems: 'center' }}><Text style={[typo.h2, { color: colors.goldInk }]}>{user?.display_name?.[0]?.toUpperCase() ?? 'A'}</Text></View><View style={{ flex: 1 }}><Text style={[typo.h2, { color: colors.text }]}>{user?.display_name ?? 'Athlete'}</Text><Text style={[typo.caption, { color: colors.muted }]}>{user?.email ?? 'Your account'}</Text><Text style={[typo.tiny, { color: colors.goldInk }]}>{user?.event_specialty ?? 'Set up your profile'}{user?.experience_level ? ' / ' + user.experience_level : ''}</Text></View><ChevronRight size={18} color={colors.muted} /></Pressable>
    <View style={{ gap: 14 }}><SectionTitle>Appearance</SectionTitle><SegmentedControl label="Appearance" value={appearance} onChange={setAppearance} options={[{ value: 'light', label: 'Light', testID: 'appearance-light' }, { value: 'dark', label: 'Dark', testID: 'appearance-dark' }, { value: 'system', label: 'System', testID: 'appearance-system' }]} /><Text style={[typo.caption, { color: colors.muted }]}>System follows your device. Your choice is remembered.</Text></View>
    <View><SectionTitle>Accessibility</SectionTitle><View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', minHeight: 72 }}><View style={{ flex: 1 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>Reduce motion</Text><Text style={[typo.caption, { color: colors.muted }]}>Quieter transitions. Device accessibility settings always take priority.</Text></View><Switch accessibilityLabel="Reduce motion" value={reduceMotion} onValueChange={setReduceMotion} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.card} /></View></View>
    <View><SectionTitle>Privacy & safety</SectionTitle><RecoveryControls recovery={recovery} />{row('Privacy Policy', 'How your video and analysis data are used', () => setLegal(PRIVACY_POLICY))}{row('Terms & Conditions', 'Coaching guidance and your responsibilities', () => setLegal(TERMS_AND_CONDITIONS))}</View>
    <View><SectionTitle>Account</SectionTitle>{row('Sign out', '', () => { setError(''); setConfirm('logout'); })}{row('Delete Account', 'Permanently remove your account and its data', () => { setError(''); setConfirm('delete'); }, true)}</View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><StrideLogo height={14} /><Text style={[typo.tiny, { color: colors.muted }]}>{Constants.expoConfig?.version ?? '0.1.0'}</Text></View>
    <Sheet visible={profile} title="Athlete profile" onClose={() => setProfile(false)}><SheetScroll keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><AthleteProfile onComplete={() => setProfile(false)} /></SheetScroll></Sheet>
    <LegalReader document={legal} onClose={() => setLegal(null)} />
    <Sheet testID="account-confirmation" visible={!!confirm} title={confirm === 'delete' ? 'Delete your account?' : 'Sign out of Stride?'} onClose={() => { if (!busy) setConfirm(null); }}><Text style={[typo.body, { color: colors.muted }]}>{confirm === 'delete' ? 'This permanently deletes your videos, analyses and coaching history. It cannot be undone.' : 'Your analyses and plan stay with your account. Sign back in whenever you are ready.'}</Text>{error ? <Notice tone="error">{error}</Notice> : null}<Button label={confirm === 'delete' ? 'Permanently delete account' : 'Sign out'} loading={busy} onPress={action} /><Button label={confirm === 'delete' ? 'Keep my account' : 'Stay signed in'} variant="secondary" disabled={busy} onPress={() => setConfirm(null)} /></Sheet>
  </Screen>;
}
