import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import type { AnalysisResult } from '../../src/types/analysis';
import { palettes, type as typo } from '../../src/theme';
import { StrideLogo } from '../../src/ui/StrideLogo';
import { CoachChat } from '../../src/components/CoachChat';
import { useTabChrome } from '../../src/context/TabChromeContext';

const stage = palettes.dark;

export default function CoachScreen() {
  const { bottomSpace } = useTabChrome();
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  const [latest, setLatest] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchAnalysisHistory()
      .then((history) => { if (active) setLatest(history[history.length - 1] ?? null); })
      .catch(() => { if (active) setError('Could not load your latest analysis. You can still ask for general advice.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]));

  const priority = latest?.flaws?.slice().sort((first, last) => last.severity - first.severity)[0];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: stage.bg, paddingBottom: bottomSpace }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 8 }}>
        <StrideLogo height={26} color={stage.text} />
        <Text accessibilityRole="header" style={[typo.h1, { color: stage.text }]}>Your coach.</Text>
        {error ? (
          <View style={{ gap: 6 }}>
            <Text style={[typo.caption, { color: stage.error }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => setAttempt(attempt + 1)}>
              <Text style={[typo.caption, { color: stage.goldInk }]}>Refresh analysis</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !error && latest ? (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(tabs)/analysis', params: { analysisId: latest.id } })}>
            <Text style={[typo.caption, { color: stage.wellMuted }]}>
              From your latest sprint · {priority ? priority.name : latest.summary}
            </Text>
            <Text style={[typo.caption, { color: stage.goldInk }]}>Open the source analysis</Text>
          </Pressable>
        ) : null}
        {!loading && !error && !latest ? (
          <View style={{ gap: 6 }}>
            <Text style={[typo.caption, { color: stage.wellMuted }]}>No sprint linked yet. Ask anything. Film a sprint when you want advice from your own measurements.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/')}>
              <Text style={[typo.caption, { color: stage.goldInk }]}>Film your first sprint</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <CoachChat
        key={analysisId ?? 'coach'}
        analysisId={analysisId ?? latest?.id}
        initialPrompt={analysisId ? 'Give me your insights on this analysis.' : undefined}
      />
    </SafeAreaView>
  );
}
