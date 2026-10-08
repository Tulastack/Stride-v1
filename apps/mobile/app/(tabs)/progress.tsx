import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowUpRight } from 'lucide-react-native';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import { computeDelta } from '../../src/lib/briefing';
import { trustedReading, sameMeasurementContext, hasMeasuredSession, sharesTrustedMeasurement } from '../../src/lib/measurementTrust';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';
import type { AnalysisResult } from '../../src/types/analysis';
import { TrendChart } from '../../src/components/progress/TrendChart';
import { SessionThumbnail } from '../../src/components/analysis/SessionThumbnail';
import { Screen, ScreenHeader, SectionTitle, Button, Notice, TrackScene, SegmentedControl, Sheet, SheetScroll } from '../../src/ui';

function day(analysis: AnalysisResult) {
  return analysis.createdAt ? new Date(analysis.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Undated session';
}
export default function ProgressScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'history' | 'insights'>('history');
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisResult | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [visibleSessions, setVisibleSessions] = useState(8);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    fetchAnalysisHistory().then((data) => { if (active) setHistory(data); }).catch(() => { if (active) setError('Could not load your sprint history. Your previous analyses have not been deleted.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]));
  const sessions = history.filter(hasMeasuredSession);
  const latest = sessions[sessions.length - 1];
  const scored = sessions.filter((analysis) => Number.isFinite(analysis.economyScore));
  const tracked = [...new Set(sessions.flatMap((analysis) => (analysis.metrics ?? []).map((metric) => metric.key)))];
  const comparable = selectedAnalysis ? sessions.filter((analysis) => sharesTrustedMeasurement(selectedAnalysis, analysis)) : [];
  const previous = selectedAnalysis ? comparable.find((analysis) => analysis.id === compare) : null;
  const comparison = previous && selectedAnalysis && sameMeasurementContext(previous, selectedAnalysis) ? selectedAnalysis.metrics.flatMap((metric) => {
    const before = previous.metrics.find((item) => item.key === metric.key);
    return before && before.unit === metric.unit && trustedReading(previous, before) && trustedReading(selectedAnalysis, metric) ? [computeDelta(before, metric)] : [];
  }) : [];

  return <Screen>
    <ScreenHeader logo title="Small changes. Real progress." subtitle={`${sessions.length} sprint${sessions.length !== 1 ? 's' : ''} analyzed`} />
    {loading ? <Notice>Loading your movement history…</Notice> : error ? <><Notice tone="error">{error}</Notice><Button label="Try again" onPress={() => setAttempt(attempt + 1)} /></> : !sessions.length ? <>
      <View style={{ backgroundColor: colors.well, borderRadius: radius.lg, overflow: 'hidden' }}><TrackScene /><View style={{ padding: 24, gap: 12 }}><Text style={[typo.editorial, { color: colors.wellText }]}>Your first sprint{'\n'}is your starting line.</Text><Text style={[typo.body, { color: colors.wellMuted }]}>Film once to establish a baseline. Come back to see what changes, not what an app guesses.</Text></View></View>
      <View style={{ gap: 16 }}>{['Capture your natural stride', 'Understand your movement', 'Practice, then compare'].map((step, index) => <View key={step} style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}><Text style={[typo.label, { color: colors.goldInk }]}>0{index + 1}</Text><Text style={[typo.body, { color: colors.text }]}>{step}</Text></View>)}</View>
      <Button label="Record a sprint" testID="retest-cta" onPress={() => router.push('/(tabs)/')} />
    </> : <>
      {scored.length ? <View style={{ gap: 12 }}><Text style={[typo.label, { color: colors.goldInk }]}>MEASURED FORM SCORE</Text><TrendChart title="Form score over time" points={scored.map((analysis) => analysis.economyScore!)} labels={scored.map(day)} /></View> : <Notice>Your reports have no form-score measurement yet. Individual readings and observations are available below.</Notice>}
      <SegmentedControl value={view} onChange={setView} options={[{ value: 'history', label: 'Sessions', testID: 'progress-view-history' }, { value: 'insights', label: 'Insights', testID: 'progress-view-insights' }]} />
      {view === 'history' ? <><SectionTitle>Your film archive</SectionTitle>{[...sessions].reverse().slice(0, visibleSessions).map((analysis) => <Pressable key={analysis.id} accessibilityRole="button" testID={`progress-log-${analysis.id}`} accessibilityLabel={`Sprint on ${day(analysis)}. ${analysis.summary}`} onPress={() => { setSelectedAnalysis(analysis); setCompare(null); }} style={{ flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderColor: colors.border }}>
        <View style={{ width: 76, height: 92, backgroundColor: colors.cardAlt, borderRadius: radius.sm, overflow: 'hidden' }}><SessionThumbnail analysisId={analysis.id} /></View>
        <View style={{ flex: 1, gap: 6 }}><Text style={[typo.h2, { color: colors.text }]}>{day(analysis)}</Text><Text style={[typo.caption, { color: colors.muted }]}>{(analysis.phase ?? 'Sprint').replace(/_/g, ' ')} · {analysis.flaws.length} issue{analysis.flaws.length !== 1 ? 's' : ''}</Text><Text numberOfLines={2} style={[typo.caption, { color: colors.muted }]}>{analysis.summary}</Text></View>
        <ArrowUpRight color={colors.goldInk} size={18} />
      </Pressable>)}{visibleSessions < sessions.length ? <Button label="Show older sessions" variant="secondary" onPress={() => setVisibleSessions(visibleSessions + 8)} /> : null}</> : <><SectionTitle>Movement, over time</SectionTitle><Text style={[typo.caption, { color: colors.muted }]}>Trusted readings only, in the same running phase and pipeline as your latest session. Similar framing is still important; these changes are not proof of improved performance.</Text>{tracked.map((key) => {
        const series = sessions.flatMap((analysis) => { const metric = analysis.metrics.find((item) => item.key === key); return metric && trustedReading(analysis, metric) && latest && sameMeasurementContext(analysis, latest) ? [{ metric, analysis }] : []; });
        if (!series.length) return null;
        return <TrendChart key={key} title={key.replace(/_/g, ' ')} unit={series[0].metric.unit} points={series.map((point) => point.metric.measured.value)} labels={series.map((point) => day(point.analysis))} />;
      })}
      <SectionTitle>Latest focus</SectionTitle>{latest.flaws.length ? latest.flaws.map((flaw) => <View key={flaw.id} style={{ gap: 8 }}><Text style={[typo.h2, { color: colors.text }]}>{flaw.name.replace(/_/g, ' ')}</Text><Text style={[typo.body, { color: colors.muted }]}>{flaw.plainExplanation}</Text></View>) : <Notice>No confirmed issues in your latest report.</Notice>}</>}
      <Button label="Record another sprint" testID="retest-cta" onPress={() => router.push('/(tabs)/')} />
    </>}
    <Sheet visible={!!selectedAnalysis} title="SCORE BREAKDOWN" onClose={() => setSelectedAnalysis(null)}>
      {selectedAnalysis ? <><SheetScroll contentContainerStyle={{ gap: 20 }}>
        <Text style={[typo.label, { color: colors.goldInk }]}>{day(selectedAnalysis)}</Text><Text style={[typo.editorial, { color: colors.text }]}>{selectedAnalysis.summary}</Text>
        <Text style={[typo.caption, { color: colors.muted }]}>Form score: {Number.isFinite(selectedAnalysis.economyScore) ? selectedAnalysis.economyScore + ' / 100' : 'not available'}</Text>
        {selectedAnalysis.flaws.map((flaw) => <View key={flaw.id} style={{ gap: 6 }}><Text style={[typo.h2, { color: colors.text }]}>{flaw.name.replace(/_/g, ' ')}</Text><Text style={[typo.body, { color: colors.muted }]}>{flaw.plainExplanation}</Text></View>)}
        {comparable.length ? <><SectionTitle>Compare a session</SectionTitle><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{comparable.map((analysis) => <Button key={analysis.id} label={day(analysis)} variant={compare === analysis.id ? 'primary' : 'secondary'} onPress={() => setCompare(analysis.id)} />)}</ScrollView>
        {comparison.length ? <><Text style={[typo.caption, { color: colors.muted }]}>Same phase and pipeline; match camera framing when comparing. Changes are not proof of performance improvement.</Text>{comparison.map((delta) => <View key={delta.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}><Text style={[typo.body, { color: colors.text, flex: 1 }]}>{delta.label}</Text><Text style={[typo.bodyMedium, { color: colors.text }]}>{delta.from} → {delta.to} {delta.unit}</Text></View>)}</> : null}</> : null}
      </SheetScroll><Button label="Open full analysis" onPress={() => { const analysisId = selectedAnalysis.id; setSelectedAnalysis(null); router.push({ pathname: '/(tabs)/analysis', params: { analysisId } }); }} /></> : null}
    </Sheet>
  </Screen>;
}
