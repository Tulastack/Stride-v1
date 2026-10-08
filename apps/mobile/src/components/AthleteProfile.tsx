import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Check } from 'lucide-react-native';
import { useStrideStore } from '../store/useStrideStore';
import { strideApi } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { space, type as typo } from '../theme';
import { Button, Field, Notice, SectionTitle, SegmentedControl } from '../ui';

export function AthleteProfile({ onComplete }: { onComplete: () => void }) {
  const { colors } = useTheme();
  const user = useStrideStore((state) => state.user);
  const setUser = useStrideStore((state) => state.setUser);
  const [name, setName] = useState(user?.display_name ?? '');
  const [event, setEvent] = useState<'100m' | '200m' | '400m' | ''>(user?.event_specialty ?? '');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced' | ''>(user?.experience_level ?? '');
  const [personalBest, setPersonalBest] = useState(user?.personal_best_seconds?.toString() ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const save = async () => {
    if (!name.trim() || !event || !level) { setError('Please complete your name, event and experience.'); return; }
    const seconds = personalBest ? Number(personalBest) : undefined;
    if (seconds != null && (!Number.isFinite(seconds) || seconds <= 0)) { setError('Enter a valid personal best in seconds.'); return; }
    setLoading(true); setError('');
    try {
      const updated = await strideApi.updateProfile({ displayName: name.trim(), eventSpecialty: event, experienceLevel: level, personalBestSeconds: seconds });
      setUser(updated); onComplete();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your profile. Try again.'); }
    finally { setLoading(false); }
  };
  return <View style={{ gap: space.xl }}>
    {error ? <Notice tone="error">{error}</Notice> : null}
    <Field label="01 / What should we call you?" placeholder="Your name" value={name} onChangeText={setName} autoComplete="name" />
    <View style={{ gap: space.md }}><SectionTitle>Your starting line</SectionTitle><Text style={[typo.caption, { color: colors.muted }]}>02 / Primary event</Text><SegmentedControl value={event} onChange={setEvent} options={(['100m', '200m', '400m'] as const).map((value) => ({ value, label: value }))} /></View>
    <View><Text style={[typo.caption, { color: colors.muted }]}>03 / Experience</Text>{([{ value: 'beginner', title: 'Finding my stride', subtitle: 'New to structured sprint training' }, { value: 'intermediate', title: 'Building consistency', subtitle: 'Training and competing regularly' }, { value: 'advanced', title: 'Chasing the next level', subtitle: 'Experienced competitive athlete' }] as const).map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: level === option.value }} accessibilityLabel={option.value} onPress={() => setLevel(option.value)} style={{ paddingVertical: 16, borderBottomWidth: 0.5, borderColor: colors.border, flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={{ flex: 1 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>{option.title}</Text><Text style={[typo.caption, { color: colors.muted }]}>{option.subtitle}</Text></View>{level === option.value ? <Check color={colors.goldInk} size={20} /> : null}</Pressable>)}</View>
    <Field label="Personal best / seconds / optional" placeholder="10.85" keyboardType="decimal-pad" value={personalBest} onChangeText={setPersonalBest} />
    <Button label="Save profile" onPress={save} loading={loading} />
  </View>;
}
