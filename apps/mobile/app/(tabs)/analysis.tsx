import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, SafeAreaView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarPlus, Check, X, ChevronRight, Target, ArrowRight } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { parseAnalysisResult, waitForAnalysisResult, type AnalysisRow } from '../../src/lib/analysisApi';
import { PoseVideoPlayer } from '../../src/components/analysis/PoseVideoPlayer';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, iconStroke } from '../../src/theme';
import type { AnalysisResult } from '../../src/types/analysis';

type Status = 'pending' | 'processing' | 'failed' | 'done';

// A pending drill suggestion (the approval gate — nothing is auto-added to the plan).
interface DrillSuggestion {
  id: string;
  drill_key: string;
  drill_name: string;
  suggested_date: string; // YYYY-MM-DD
  status: 'pending' | 'approved' | 'skipped';
}

// Severity index → label + a red-to-green color, worst to mildest.
const SEVERITY_LABELS: Record<number, { label: string; color: string }> = {
  5: { label: 'MAJOR', color: '#DC2626' },
  4: { label: 'SIGNIFICANT', color: '#EA580C' },
  3: { label: 'MODERATE', color: '#D97706' },
  2: { label: 'MINOR', color: '#CA8A04' },
  1: { label: 'MINOR', color: '#65A30D' },
};

// Friendly labels for every metric key the analyzers emit (sagittal + frontal).
const METRIC_LABEL: Record<string, string> = {
  trunk_lean: 'Trunk lean', knee_drive: 'Knee drive', hip_extension: 'Hip extension',
  knee_flexion: 'Knee flexion', arm_swing: 'Arm swing', overstride: 'Overstride',
  vertical_oscillation: 'Vertical bounce', contact_time_ms: 'Ground contact', cadence_spm: 'Cadence',
  knee_valgus: 'Knee collapse', pelvic_drop: 'Hip drop', arm_crossover: 'Arm crossover',
  foot_crossover: 'Foot crossover', stance_width: 'Stance width', head_tilt: 'Head tilt',
};
const metricLabel = (k: string) => METRIC_LABEL[k] ?? k.replace(/_/g, ' ');

function severityInfo(index: number, total: number): { label: string; color: string } {
  if (total <= 1) return SEVERITY_LABELS[3];
  return SEVERITY_LABELS[Math.max(1, 5 - index)] ?? SEVERITY_LABELS[3];
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
  const [status, setStatus] = useState<Status>('pending');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Approval-gate state
  const [suggestions, setSuggestions] = useState<DrillSuggestion[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const loadSuggestions = useCallback(async (id: string) => {
    try {
      const rows = (await strideApi.getSuggestions(id)) as DrillSuggestion[];
      setSuggestions(rows ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  // Each load bumps the generation; stale loops (unmount, analysisId change,
  // retry) see a newer generation, stop polling, and never setState again.
  const loadGenRef = useRef(0);

  const load = useCallback(async (id?: string) => {
    const gen = ++loadGenRef.current;
    const isCancelled = () => loadGenRef.current !== gen;

    if (!id) { setStatus('failed'); setError('No analysis ID provided.'); return; }
    setStatus('pending');
    setError(null);
    setResult(null);

    try {
      const row = (await strideApi.getAnalysis(id)) as AnalysisRow;
      if (isCancelled()) return;
      if (row.status === 'failed') { setStatus('failed'); setError(row.error_message ?? 'Analysis failed.'); return; }
      if (row.status === 'completed') {
        const parsed = parseAnalysisResult(row);
        if (!parsed) { setStatus('failed'); setError('Result is missing or invalid.'); return; }
        setResult(parsed); setStatus('done'); loadSuggestions(id); return;
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
    setBusy(s.id, true);
    try {
      await strideApi.approveSuggestion(s.id);
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'approved' } : x)));
    } catch {
      // leave as pending so the user can retry
    } finally { setBusy(s.id, false); }
  }, []);

  const skip = useCallback(async (s: DrillSuggestion) => {
    setBusy(s.id, true);
    try {
      await strideApi.skipSuggestion(s.id);
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'skipped' } : x)));
    } catch {
      // no-op
    } finally { setBusy(s.id, false); }
  }, []);

  const topFlaws = useMemo(() => {
    if (!result) return [];
    return [...result.flaws].sort((a, b) => b.severity - a.severity).slice(0, 5);
  }, [result]);

  const pending = suggestions.filter((s) => s.status === 'pending');
  const approved = suggestions.filter((s) => s.status === 'approved');

  if (status === 'pending' || status === 'processing') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>
            {status === 'processing' ? 'Analyzing your sprint...' : 'Loading...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'failed' || !result) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <Text style={[styles.failTitle, { color: colors.error }]}>Analysis Failed</Text>
          <Text style={[styles.failMsg, { color: colors.muted }]}>{friendlyError(error)}</Text>
          <Pressable style={[styles.retryBtn, { borderColor: colors.border }]} onPress={() => load(analysisId)}>
            <Text style={[styles.retryText, { color: colors.text }]}>Try Again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const formScore = result.economyScore ?? (result.flaws.length === 0 ? 95 : Math.max(40, 100 - result.flaws.length * 10));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Skeleton overlay video */}
        {analysisId ? (
          <PoseVideoPlayer analysisId={analysisId} seekToMs={topFlaws[0]?.evidence?.frameTimestampMs} />
        ) : null}

        {/* Score — ink, not accent: the number is the fact, gold is for actions */}
        <View style={styles.scoreSection}>
          <Text style={[styles.scoreLabel, { color: colors.muted }]}>FORM SCORE</Text>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreNumber, { color: colors.text }]}>{formScore}</Text>
            <Text style={[styles.scoreOutOf, { color: colors.muted }]}>/100</Text>
          </View>
        </View>

        <Text style={[styles.summary, { color: colors.text }]}>{result.summary}</Text>

        {/* Measurements — the full breakdown, so it's never "just a score". Every
            metric shows its value, ideal range, and whether we could trust it. */}
        {result.metrics && result.metrics.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>YOUR MEASUREMENTS</Text>
            {result.metrics.map((m) => {
              const [lo, hi] = m.normalRange ?? [0, 0];
              const experimental = m.trustStatus === 'experimental';
              const inRange = !experimental && m.measured.value >= lo && m.measured.value <= hi;
              const valueColor = experimental ? colors.muted : inRange ? colors.success : colors.accent;
              return (
                <View key={m.key} style={[styles.metricRow, { borderBottomColor: colors.border }]}>
                  <View style={styles.metricLeft}>
                    <Text style={[styles.metricLabel, { color: experimental ? colors.muted : colors.text }]}>
                      {metricLabel(m.key)}
                    </Text>
                    {experimental ? (
                      <Text style={[styles.metricTag, { color: colors.muted }]}>experimental</Text>
                    ) : !inRange ? (
                      <Text style={[styles.metricTag, { color: colors.accent }]}>needs work</Text>
                    ) : null}
                  </View>
                  <View style={styles.metricRight}>
                    <Text style={[styles.metricValue, { color: valueColor }]}>
                      {m.measured.value}
                      <Text style={[styles.metricUnit, { color: colors.muted }]}> {m.unit}</Text>
                    </Text>
                    {(lo || hi) ? (
                      <Text style={[styles.metricRange, { color: colors.muted }]}>ideal {lo}–{hi}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
            <Text style={[styles.sectionHint, { color: colors.muted }]}>
              "Experimental" values need a cleaner side-on, well-lit, high-frame-rate clip before we'll stand behind them.
            </Text>
          </View>
        )}

        {/* Issues */}
        {topFlaws.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>AREAS TO IMPROVE</Text>
            {topFlaws.map((flaw, index) => {
              const { label, color } = severityInfo(index, topFlaws.length);
              return (
                <View key={flaw.id} style={[styles.issueCard, { backgroundColor: colors.card, borderLeftColor: color }]}>
                  <View style={styles.issueHeader}>
                    <View style={[styles.severityBadge, { backgroundColor: color }]}>
                      <Text style={styles.severityText}>{label}</Text>
                    </View>
                  </View>
                  <Text style={[styles.issueTitle, { color: colors.text }]}>{flaw.name.replace(/_/g, ' ')}</Text>
                  <Text style={[styles.issueDesc, { color: colors.muted }]}>{flaw.plainExplanation}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Approval gate — Add to your plan / Skip. Nothing is auto-scheduled. */}
        {(pending.length > 0 || approved.length > 0) && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>ADD TO YOUR PLAN</Text>
            <Text style={[styles.sectionHint, { color: colors.muted }]}>
              You choose what gets scheduled — nothing is added automatically.
            </Text>

            {pending.map((s) => {
              const busy = busyIds.has(s.id);
              return (
                <View key={s.id} style={[styles.suggCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.suggInfo}>
                    <Text style={[styles.suggName, { color: colors.text }]}>{s.drill_name}</Text>
                    <Text style={[styles.suggDate, { color: colors.muted }]}>Suggested for {formatDay(s.suggested_date)}</Text>
                  </View>
                  <View style={styles.suggActions}>
                    <Pressable
                      accessibilityLabel={`skip-${s.drill_key}`}
                      disabled={busy}
                      style={[styles.iconBtn, { borderColor: colors.border }]}
                      onPress={() => skip(s)}
                    >
                      <X size={18} color={colors.muted} strokeWidth={2.25} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`add-to-plan-${s.drill_key}`}
                      disabled={busy}
                      style={[styles.addBtn, { backgroundColor: colors.accent }]}
                      onPress={() => approve(s)}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.accentText} />
                      ) : (
                        <>
                          <CalendarPlus size={16} color={colors.accentText} strokeWidth={2.25} />
                          <Text style={[styles.addBtnText, { color: colors.accentText }]}>Add</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}

            {approved.map((s) => (
              <View key={s.id} style={[styles.approvedRow]}>
                <Check size={16} color={colors.success} strokeWidth={2.5} />
                <Text style={[styles.approvedText, { color: colors.muted }]}>
                  {s.drill_name} — added for {formatDay(s.suggested_date)}
                </Text>
              </View>
            ))}

            {approved.length > 0 && (
              <Pressable style={[styles.viewPlanBtn, { borderColor: colors.accent }]} onPress={() => router.push('/(tabs)/calendar')}>
                <Text style={[styles.viewPlanText, { color: colors.accent }]}>View in Plan</Text>
                <ArrowRight size={16} color={colors.accent} strokeWidth={2.25} />
              </Pressable>
            )}
          </View>
        )}

        {/* Fallback quick fixes when no structured suggestions were generated */}
        {suggestions.length === 0 && result.recommendations && result.recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>QUICK FIXES</Text>
            {result.recommendations.slice(0, 3).map((rec) => (
              <View key={rec.drillId} style={[styles.drillItem, { borderBottomColor: colors.border }]}>
                <Target size={16} color={colors.accent} strokeWidth={iconStroke} />
                <View style={styles.drillInfo}>
                  <Text style={[styles.drillName, { color: colors.text }]}>{rec.drillName}</Text>
                  <Text style={[styles.drillVolume, { color: colors.muted }]}>{rec.sets} sets × {rec.reps} reps</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* CTA to AI Coach */}
        <Pressable style={[styles.coachCta, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push({ pathname: '/(tabs)/coach', params: { analysisId } })}>
          <View style={styles.coachCtaContent}>
            <Text style={[styles.coachCtaTitle, { color: colors.accent }]}>Want personalized tips?</Text>
            <Text style={[styles.coachCtaSubtitle, { color: colors.muted }]}>Chat with your AI coach for drills, plans, and more</Text>
          </View>
          <ChevronRight size={20} color={colors.accent} strokeWidth={iconStroke} />
        </Pressable>

        <Text accessibilityLabel="analysis-disclaimer" style={[styles.disclaimer, { color: colors.muted }]}>
          Results are based on video analysis. For best accuracy, film your full body from the side in good lighting.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  failTitle: { fontSize: 20, fontWeight: '800' },
  failMsg: { fontSize: 14, textAlign: 'center' },
  retryBtn: { borderWidth: 1, paddingVertical: 12, paddingHorizontal: 24, marginTop: 12, borderRadius: radius.sm },
  retryText: { fontSize: 14, fontWeight: '800' },
  scroll: { padding: space.xl, paddingBottom: 48 },
  scoreSection: { marginBottom: space.xl },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  scoreNumber: { fontSize: 72, fontWeight: '800', letterSpacing: -2, lineHeight: 74, fontVariant: ['tabular-nums'] },
  scoreOutOf: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  scoreLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  summary: { fontSize: 15, lineHeight: 22, marginBottom: space.xl },
  section: { marginBottom: space.xl },
  sectionTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginBottom: space.sm },
  sectionHint: { fontSize: 12, marginBottom: space.md, lineHeight: 17 },
  issueCard: { padding: space.lg, marginBottom: 10, borderLeftWidth: 3, borderRadius: radius.sm },
  issueHeader: { flexDirection: 'row', marginBottom: 6 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  severityText: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: '#FFFFFF' },
  issueTitle: { fontSize: 16, fontWeight: '700', textTransform: 'capitalize', marginBottom: 4 },
  issueDesc: { fontSize: 13, lineHeight: 19 },
  // measurements breakdown
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  metricLeft: { flex: 1, gap: 2 },
  metricLabel: { fontSize: 15, fontWeight: '700' },
  metricTag: { fontSize: 11, fontWeight: '700', fontStyle: 'italic' },
  metricRight: { alignItems: 'flex-end', gap: 1 },
  metricValue: { fontSize: 18, fontWeight: '800' },
  metricUnit: { fontSize: 12, fontWeight: '600' },
  metricRange: { fontSize: 11 },
  // approval gate
  suggCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, marginBottom: 10, borderWidth: 1, borderRadius: radius.md },
  suggInfo: { flex: 1, paddingRight: space.md },
  suggName: { fontSize: 15, fontWeight: '800' },
  suggDate: { fontSize: 12, marginTop: 2 },
  suggActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconBtn: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: space.lg, borderRadius: radius.sm },
  addBtnText: { fontSize: 14, fontWeight: '800' },
  approvedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  approvedText: { fontSize: 13, fontWeight: '600' },
  viewPlanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.md, marginTop: space.sm },
  viewPlanText: { fontSize: 14, fontWeight: '800' },
  // fallback drills
  drillItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  drillInfo: { flex: 1 },
  drillName: { fontSize: 14, fontWeight: '700' },
  drillVolume: { fontSize: 12, marginTop: 2 },
  coachCta: { flexDirection: 'row', alignItems: 'center', padding: space.lg, borderRadius: radius.md, marginBottom: space.xl, borderWidth: 1 },
  coachCtaContent: { flex: 1 },
  coachCtaTitle: { fontSize: 15, fontWeight: '700' },
  coachCtaSubtitle: { fontSize: 12, marginTop: 2 },
  disclaimer: { fontSize: 11, textAlign: 'center' },
});
