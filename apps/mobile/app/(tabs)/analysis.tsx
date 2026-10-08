import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { strideApi } from '../../src/services/api';
import { parseAnalysisResult, waitForAnalysisResult, type AnalysisRow } from '../../src/lib/analysisApi';
import { PoseVideoPlayer } from '../../src/components/analysis/PoseVideoPlayer';
import { MetricRow } from '../../src/components/analysis/MetricRow';
import { DrillCard } from '../../src/components/analysis/DrillCard';
import { CaptureQualityCard } from '../../src/components/analysis/CaptureQualityCard';
import { Screen, ScreenHeader, TrackScene, Button, Notice, SectionTitle, SegmentedControl } from '../../src/ui';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, type as typo } from '../../src/theme';
import type { AnalysisResult } from '../../src/types/analysis';
import { trustedReading } from '../../src/lib/measurementTrust';
import { useRecoveryStatus } from '../../src/hooks/useRecoveryStatus';
import { RecoveryControls } from '../../src/components/RecoveryControls';

type Status = 'pending' | 'processing' | 'failed' | 'done';

// A pending drill suggestion (the approval gate, nothing is auto-added to the plan).
interface DrillSuggestion {
  id: string;
  drill_key: string;
  drill_name: string;
  suggested_date: string; // YYYY-MM-DD
  status: 'pending' | 'approved' | 'skipped';
}

// Engine severity is 1..3 (see severityFrom). Anything above 3 still reads as major.
function severityLabel(severity: number): 'MAJOR' | 'MODERATE' | 'MINOR' {
  if (severity >= 3) return 'MAJOR';
  if (severity === 2) return 'MODERATE';
  return 'MINOR';
}


function friendlyError(err?: string | null): string {
  if (!err) return 'Something went wrong analyzing your run.';
  if (err.includes('low_confidence_video')) {
    return "We couldn't track your body clearly. Film your full body from the side, in good lighting, then try again.";
  }
  if (err.includes('video not found')) {
    return "Your video didn't finish uploading. Check your connection and re-upload.";
  }
  return err;
}

function formatDay(iso: string): string {
  // Parse as a plain local date (no UTC shift) for display.
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function AnalysisScreen() {
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const recovery = useRecoveryStatus();
  const canPrescribe = recovery.ready && !recovery.isInjured && !recovery.busy;
  const [status, setStatus] = useState<Status>('pending');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState<'overview' | 'measurements' | 'practice'>('overview');
  const [seek, setSeek] = useState<number | undefined>();
  const [scheduleError, setScheduleError] = useState('');
  const [suggestionError, setSuggestionError] = useState('');
  const loadGenRef = useRef(0);
  const mutationLocks = useRef(new Set<string>());

  // Approval-gate state
  const [suggestions, setSuggestions] = useState<DrillSuggestion[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // How many sessions the approved program actually created, keyed by suggestion id
  // - lets the confirmation row say "6 sessions over 3 weeks" instead of "added".
  const [planSizes, setPlanSizes] = useState<Record<string, number>>({});

  const loadSuggestions = useCallback(async (id: string) => {
    const generation = loadGenRef.current;
    setSuggestionError('');
    try {
      const rows = (await strideApi.getSuggestions(id)) as DrillSuggestion[];
      if (generation !== loadGenRef.current) return;
      setSuggestions(rows ?? []);
    } catch {
      if (generation === loadGenRef.current) setSuggestionError('Could not load your practice suggestions. Your measured report is still available.');
    }
  }, []);

  // Each load bumps the generation; stale loops (unmount, analysisId change,
  // retry) see a newer generation, stop polling, and never setState again.

  const load = useCallback(async (id?: string) => {
    const gen = ++loadGenRef.current;
    const isCancelled = () => loadGenRef.current !== gen;

    if (!id) { setStatus('failed'); setError('No analysis ID provided.'); return; }
    setStatus('pending');
    setError(null);
    setResult(null);
    setSuggestions([]); setPlanSizes({}); setLens('overview'); setScheduleError(''); setSuggestionError(''); setBusyIds(new Set()); mutationLocks.current.clear();

    try {
      const row = (await strideApi.getAnalysis(id)) as AnalysisRow;
      if (isCancelled()) return;
      if (row.status === 'failed') { setStatus('failed'); setError(row.error_message ?? 'Analysis failed.'); return; }
      if (row.status === 'completed') {
        const parsed = parseAnalysisResult(row);
        if (!parsed) { setStatus('failed'); setError('Result is missing or invalid.'); return; }
        setResult({ ...parsed, id: row.id || id }); setStatus('done'); loadSuggestions(id); return;
      }
      setStatus('processing');
      const outcome = await waitForAnalysisResult(id, { intervalMs: 2000, timeoutMs: 180_000, isCancelled });
      if (isCancelled()) return;
      if (outcome.status === 'completed' && outcome.result) { setResult(outcome.result); setStatus('done'); loadSuggestions(id); }
      else { setStatus('failed'); setError(outcome.error ?? 'Analysis did not complete.'); }
    } catch (e: unknown) {
      if (isCancelled() || (e instanceof Error && e.name === 'CancelledError')) return;
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Could not load analysis.');
    }
  }, [loadSuggestions]);

  useEffect(() => {
    load(analysisId);
    // Cancel the in-flight poll loop when leaving or switching analyses.
    return () => { loadGenRef.current++; };
  }, [analysisId, load]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => { const next = new Set(prev); on ? next.add(id) : next.delete(id); return next; });

  const approve = useCallback(async (s: DrillSuggestion) => {
    if (!canPrescribe || mutationLocks.current.has(s.id)) return;
    mutationLocks.current.add(s.id);
    const generation = loadGenRef.current;
    setScheduleError('');
    setBusy(s.id, true);
    try {
      const result = await strideApi.approveSuggestion(s.id);
      if (generation !== loadGenRef.current) return;
      if (Array.isArray(result?.plan)) setPlanSizes((prev) => ({ ...prev, [s.id]: result.plan.length }));
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'approved' } : x)));
    } catch {
      if (generation === loadGenRef.current) setScheduleError('Could not confirm scheduling. Check your plan before trying again.');
    } finally { mutationLocks.current.delete(s.id); if (generation === loadGenRef.current) setBusy(s.id, false); }
  }, [canPrescribe]);

  const skip = useCallback(async (s: DrillSuggestion) => {
    if (mutationLocks.current.has(s.id)) return;
    mutationLocks.current.add(s.id);
    const generation = loadGenRef.current;
    setScheduleError('');
    setBusy(s.id, true);
    try {
      await strideApi.skipSuggestion(s.id);
      if (generation !== loadGenRef.current) return;
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'skipped' } : x)));
    } catch {
      if (generation === loadGenRef.current) setScheduleError('Could not skip this recommendation. Please try again.');
    } finally { mutationLocks.current.delete(s.id); if (generation === loadGenRef.current) setBusy(s.id, false); }
  }, []);

  const topFlaws = useMemo(() => {
    if (!result) return [];
    return [...result.flaws].sort((a, b) => b.severity - a.severity).slice(0, 5);
  }, [result]);

  const pending = suggestions.filter((s) => s.status === 'pending');
  const approved = suggestions.filter((s) => s.status === 'approved');

  if (status === 'pending' || status === 'processing') return <Screen>
    <ScreenHeader logo title="Reading your movement." />
    <View style={[styles.observatory, { backgroundColor: colors.well }]}><TrackScene /><View style={styles.observatoryCopy}><Text style={[typo.label, { color: colors.accent }]}>REPORT / {status === 'processing' ? 'PROCESSING' : 'REQUESTED'}</Text><Text accessibilityLiveRegion="polite" style={[typo.h2, { color: colors.wellText }]}>{status === 'processing' ? 'Analyzing your sprint...' : 'Loading...'}</Text><ActivityIndicator color={colors.accent} /></View></View>
    <Text style={[typo.body, { color: colors.muted }]}>Your report appears when the analysis is complete. Measurements are checked for confidence before they become coaching cues.</Text>
    <Button label="Back to capture" variant="secondary" onPress={() => router.push('/(tabs)/')} />
  </Screen>;

  if (status === 'failed' || !result) return <Screen>
    <ScreenHeader title="Let's get a clearer view." />
    <Notice tone="error">Analysis Failed</Notice><Text style={[typo.body, { color: colors.muted }]}>{friendlyError(error)}</Text>
    <Button label="Try Again" onPress={() => load(analysisId)} /><Button label="Record another sprint" variant="secondary" onPress={() => router.push('/(tabs)/')} />
  </Screen>;

  const trustedCount = (result.metrics ?? []).filter((metric) => trustedReading(result, metric, 0.5)).length;
  const score = Number.isFinite(result.economyScore) ? result.economyScore : null;

  return <Screen style={{ gap: space.lg }}>
    <ScreenHeader eyebrow="Movement report" title="Your stride, understood." subtitle={(result.phase ?? 'sprint').replace(/_/g, ' ')} />
    {analysisId ? <View style={[styles.film, { backgroundColor: colors.well }]}><View style={styles.filmHeader}><Text style={[typo.label, { color: colors.accent }]}>YOUR FILM</Text><Text style={[typo.caption, { color: colors.wellMuted }]}>Real video · 2D tracking</Text></View><PoseVideoPlayer analysisId={analysisId} seekToMs={seek} /></View> : null}
    <View style={[styles.reportRail, { borderColor: colors.border }]}><View style={{ flex: 1 }}><Text style={[typo.label, { color: colors.muted }]}>FORM SCORE</Text><Text style={[score == null ? typo.h2 : typo.numeric, { color: colors.text }]}>{score == null ? 'Not available' : score}<Text style={[typo.caption, { color: colors.muted }]}>{score == null ? '' : ' / 100'}</Text></Text></View><View><Text style={[typo.label, { color: colors.muted }]}>TRUSTED READINGS</Text><Text style={[typo.h2, { color: colors.text, fontVariant: ['tabular-nums'] }]}>{trustedCount} / {result.metrics?.length ?? 0}</Text></View></View>
    <SegmentedControl value={lens} onChange={setLens} options={[{ value: 'overview', label: 'Overview' }, { value: 'measurements', label: 'Measurements' }, { value: 'practice', label: 'Practice' }]} />
    <RecoveryControls recovery={recovery} />
    {lens === 'overview' ? <>
      <Text style={[typo.editorial, { color: colors.text }]}>{result.summary}</Text>
      {topFlaws.length ? <><SectionTitle>Areas to improve</SectionTitle>{topFlaws.map((flaw, index) => {
        const recommendation = result.recommendations?.find((item) => item.flawId === flaw.id);
        const severity = severityLabel(flaw.severity);
        return <View key={flaw.id} style={[styles.observation, { borderColor: colors.border }]}>
          <View style={styles.observationHeader}><Text style={[typo.label, { color: colors.muted }]}>0{index + 1} / OBSERVATION</Text><Text style={[typo.label, { color: severity === 'MAJOR' ? colors.error : colors.goldInk }]}>{severity}</Text></View>
          <Text style={[typo.h2, { color: colors.text }]}>{flaw.name.replace(/_/g, ' ')}</Text><Text style={[typo.body, { color: colors.muted }]}>{flaw.plainExplanation}</Text>
          {flaw.evidence?.frameTimestampMs != null ? <Button label="View evidence frame" variant="quiet" onPress={() => setSeek(flaw.evidence.frameTimestampMs)} /> : null}
          {recommendation && canPrescribe ? <><Text style={[typo.bodyMedium, { color: colors.goldInk }]}>Cue: {recommendation.cue}</Text><Button label={recommendation.drillName} variant="secondary" onPress={() => setLens('practice')} /></> : null}
        </View>;
      })}</> : <Notice>No confirmed form issues in this report. This is not a guarantee that every movement is ideal.</Notice>}
      {result.focusAreas?.length ? <><SectionTitle>Refine next</SectionTitle><Text style={[typo.caption, { color: colors.muted }]}>Exploratory readings, not confirmed faults.</Text>{result.focusAreas.map((area) => <View key={area.id} style={[styles.observation, { borderColor: colors.border }]}><Text style={[typo.label, { color: colors.muted }]}>{area.kind === 'unconfirmed' ? 'UNCONFIRMED READ' : 'NEAR THE TARGET EDGE'}</Text><Text style={[typo.h2, { color: colors.text }]}>{area.name.replace(/_/g, ' ')}</Text><Text style={[typo.body, { color: colors.muted }]}>{area.plainExplanation}</Text>{area.drill && canPrescribe ? <Text style={[typo.caption, { color: colors.goldInk }]}>{area.drill.drillName} · {area.drill.sets} × {area.drill.reps}</Text> : null}</View>)}</> : null}
      <Button label="Want personalized tips?" variant="secondary" onPress={() => router.push({ pathname: '/(tabs)/coach', params: { analysisId } })} />
    </> : lens === 'measurements' ? <>
      <SectionTitle>Inside the measurements</SectionTitle><Text style={[typo.caption, { color: colors.muted }]}>Open a reading for its uncertainty band and target range. Low-quality measurements are withheld, not guessed.</Text>
      {(result.metrics ?? []).map((metric) => <MetricRow key={metric.key} metric={metric} usable={result.captureQuality?.perMetricUsable?.[metric.key]} />)}
      {!result.metrics?.length ? <Notice>This report does not include individual measurements.</Notice> : null}
      {result.captureQuality ? <CaptureQualityCard capture={result.captureQuality} /> : null}
    </> : <>
      <SectionTitle>Your next practice</SectionTitle><Text style={[typo.body, { color: colors.muted }]}>A cue you can take to the track, not another number to memorize.</Text>
      {canPrescribe ? (result.recommendations ?? []).map((recommendation) => <DrillCard key={recommendation.drillId} rec={recommendation} analysisId={analysisId} seekMs={topFlaws.find((flaw) => flaw.id === recommendation.flawId)?.evidence?.frameTimestampMs} />) : <Notice>Sprint practice is paused. Your measured report remains available in Overview and Measurements.</Notice>}
      {canPrescribe && !result.recommendations?.length ? <Notice>No corrective drills were prescribed in this report. Ask your coach for general training guidance.</Notice> : null}
    </>}
    {suggestionError ? <><Notice tone="error">{suggestionError}</Notice><Button label="Reload practice suggestions" variant="secondary" onPress={() => { if (analysisId) loadSuggestions(analysisId); }} /></> : null}
    {canPrescribe && (pending.length || approved.length) ? <><SectionTitle>ADD TO YOUR PLAN</SectionTitle><Text style={[typo.caption, { color: colors.muted }]}>Only your approval schedules a progressive program.</Text>{scheduleError ? <Notice tone="error">{scheduleError}</Notice> : null}
      {pending.map((suggestion) => <View key={suggestion.id} style={[styles.observation, { backgroundColor: colors.cardAlt, borderColor: colors.border, padding: 16, borderRadius: radius.md }]}><Text style={[typo.h2, { color: colors.text }]}>{suggestion.drill_name}</Text><Text style={[typo.caption, { color: colors.muted }]}>Progressive program · starts {formatDay(suggestion.suggested_date)}</Text><View style={{ flexDirection: 'row', gap: 8 }}><Button label="Skip" testID={`skip-${suggestion.drill_key}`} accessibilityLabel={`Skip ${suggestion.drill_name}`} variant="quiet" disabled={busyIds.has(suggestion.id)} onPress={() => skip(suggestion)} /><Button label="Add to plan" testID={`add-to-plan-${suggestion.drill_key}`} accessibilityLabel={`Add ${suggestion.drill_name} to plan`} loading={busyIds.has(suggestion.id)} onPress={() => approve(suggestion)} style={{ flex: 1 }} /></View></View>)}
      {approved.map((suggestion) => <Notice key={suggestion.id}>{suggestion.drill_name}, {planSizes[suggestion.id] ? `${planSizes[suggestion.id]} sessions added` : 'program scheduled'}, starting {formatDay(suggestion.suggested_date)}</Notice>)}
      {approved.length ? <Button label="View in Plan" variant="secondary" onPress={() => router.push('/(tabs)/calendar')} /> : null}
    </> : null}
    <Text testID="analysis-disclaimer" style={[typo.caption, { color: colors.muted }]}>Coaching insights, not medical advice. Measurement quality depends on the view and footage.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  observatory: { borderRadius: radius.lg, overflow: 'hidden' }, observatoryCopy: { padding: space.xl, gap: space.lg },
  film: { borderRadius: radius.md, overflow: 'hidden' }, filmHeader: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, flexDirection: 'row', justifyContent: 'space-between' },
  reportRail: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg, paddingVertical: space.lg, borderBottomWidth: 0.5 },
  observation: { paddingVertical: space.lg, borderBottomWidth: 0.5, gap: space.md },
  observationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
