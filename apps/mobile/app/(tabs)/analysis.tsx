import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, SafeAreaView, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { strideApi } from '../../src/services/api';
import { parseAnalysisResult, waitForAnalysisResult, type AnalysisRow } from '../../src/lib/analysisApi';
import { semantic, spacing, radius, borderWidth, typography } from '../../src/ui/theme';
import {
  EvidenceAnchor,
  FlawCard,
  DrillCard,
  MetricRow,
  CaptureQualityCard,
} from '../../src/components/analysis';
import type { AnalysisResult, Flaw } from '../../src/types/analysis';

type Status = 'pending' | 'processing' | 'failed' | 'done';

/** Turn worker error codes into actionable, human-readable guidance. */
function friendlyError(err?: string | null): string {
  if (!err) return 'Something went wrong analyzing your run.';
  if (err.includes('low_confidence_video')) {
    return "We couldn't track your body clearly enough. Film your FULL body from the SIDE, in good lighting, with the whole run in frame — then try again.";
  }
  if (err.includes('video not found')) {
    return 'Your video didn\'t finish uploading. Check your connection and re-upload.';
  }
  return err;
}

function severitySort(a: Flaw, b: Flaw): number {
  return b.severity - a.severity;
}

export default function AnalysisScreen() {
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  const [status, setStatus] = useState<Status>('pending');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (id?: string) => {
    if (!id) {
      setStatus('failed');
      setError('No analysis ID provided.');
      return;
    }

    setStatus('pending');
    setError(null);
    setResult(null);

    try {
      const row = (await strideApi.getAnalysis(id)) as AnalysisRow;

      if (row.status === 'failed') {
        setStatus('failed');
        setError(row.error_message ?? 'Analysis failed.');
        return;
      }

      if (row.status === 'completed') {
        const parsed = parseAnalysisResult(row);
        if (!parsed) {
          setStatus('failed');
          setError('Analysis completed but result is missing or invalid.');
          return;
        }
        setResult(parsed);
        setStatus('done');
        return;
      }

      setStatus('processing');
      const outcome = await waitForAnalysisResult(id, { intervalMs: 2000, timeoutMs: 180_000 });
      if (outcome.status === 'completed' && outcome.result) {
        setResult(outcome.result);
        setStatus('done');
      } else {
        setStatus('failed');
        setError(outcome.error ?? 'Analysis did not complete.');
      }
    } catch (e: unknown) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Could not load analysis.');
    }
  }, []);

  useEffect(() => {
    load(analysisId);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [analysisId, load]);

  const sortedFlaws = useMemo(() => (result ? [...result.flaws].sort(severitySort) : []), [result]);
  const worstFlaw = sortedFlaws[0];
  const recByFlaw = useMemo(() => {
    const m = new Map<string, AnalysisResult['recommendations']>();
    result?.recommendations.forEach((r) => {
      const arr = m.get(r.flawId) ?? [];
      arr.push(r);
      m.set(r.flawId, arr);
    });
    return m;
  }, [result]);

  if (status === 'pending' || status === 'processing') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center} accessibilityLabel="analysis-scanning">
          <ActivityIndicator size="large" color={semantic.action.primary} />
          <Text style={styles.scanText}>
            {status === 'processing' ? 'RTMPOSE · CANONICALIZING' : 'LOADING ANALYSIS'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'failed' || !result) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center} accessibilityLabel="analysis-failed">
          <Text style={styles.failTitle}>Analysis failed</Text>
          <Text style={styles.failMsg}>{friendlyError(error)}</Text>
          <Pressable style={styles.retry} onPress={() => load(analysisId)} accessibilityLabel="analysis-retry">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Biomechanics Report</Text>

        {worstFlaw ? <EvidenceAnchor flaw={worstFlaw} testID="evidence-anchor" /> : null}

        <Text style={styles.summary} accessibilityLabel="analysis-summary">
          {result.summary}
        </Text>

        <CaptureQualityCard capture={result.captureQuality} testID="capture-quality" />

        <Text style={styles.section}>WHAT WE FOUND</Text>
        {sortedFlaws.map((flaw) => (
          <View key={flaw.id} style={styles.flawBlock}>
            <FlawCard flaw={flaw} testID={`flawcard-${flaw.id}`} />
            {(recByFlaw.get(flaw.id) ?? []).map((rec) => (
              <DrillCard key={rec.drillId} rec={rec} testID={`drillcard-${rec.drillId}`} />
            ))}
          </View>
        ))}

        <Text style={styles.section}>ALL METRICS</Text>
        {(['Lower Body', 'Upper Body', 'Timing'] as const).map((group) => {
          const groupKeys: Record<string, string[]> = {
            'Lower Body': ['knee_drive', 'hip_extension', 'overstride', 'ground_contact_time', 'ankle_dorsiflexion'],
            'Upper Body': ['trunk_lean', 'arm_drive', 'shoulder_rotation', 'torso_lean'],
            'Timing': ['stride_frequency', 'flight_time', 'cadence', 'stance_time'],
          };
          const keys = groupKeys[group] || [];
          const groupMetrics = result.metrics.filter((m) => keys.includes(m.key));
          if (groupMetrics.length === 0) return null;
          return (
            <View key={group} style={styles.metricsGroup}>
              <Text style={styles.metricsGroupTitle}>{group.toUpperCase()}</Text>
              <View style={styles.metricsCard}>
                {groupMetrics.map((m, i) => (
                  <View key={m.key}>
                    <MetricRow metric={m} usable={result.captureQuality.perMetricUsable[m.key]} testID={`metricrow-${m.key}`} />
                    {i < groupMetrics.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))}
              </View>
            </View>
          );
        })}
        {/* Ungrouped metrics */}
        {(() => {
          const allGrouped = ['knee_drive', 'hip_extension', 'overstride', 'ground_contact_time', 'ankle_dorsiflexion', 'trunk_lean', 'arm_drive', 'shoulder_rotation', 'torso_lean', 'stride_frequency', 'flight_time', 'cadence', 'stance_time'];
          const ungrouped = result.metrics.filter((m) => !allGrouped.includes(m.key));
          if (ungrouped.length === 0) return null;
          return (
            <View style={styles.metricsGroup}>
              <Text style={styles.metricsGroupTitle}>OTHER</Text>
              <View style={styles.metricsCard}>
                {ungrouped.map((m, i) => (
                  <View key={m.key}>
                    <MetricRow metric={m} usable={result.captureQuality.perMetricUsable[m.key]} testID={`metricrow-${m.key}`} />
                    {i < ungrouped.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        <Text style={styles.disclaimer} accessibilityLabel="analysis-disclaimer">
          Stride provides biomechanics guidance, not medical advice. Numbers are reported with
          confidence bands; low-confidence metrics are labeled, never shown as solid.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: semantic.surface.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  scanText: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 2 },
  failTitle: { ...(typography.title as object), color: semantic.status.flaw },
  failMsg: { ...(typography.body as object), color: semantic.text.secondary, textAlign: 'center' },
  retry: {
    borderWidth: borderWidth.hairline,
    borderColor: semantic.action.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  retryText: { ...(typography.bodyStrong as object), color: semantic.action.primary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  title: { ...(typography.display as object), color: semantic.text.primary, marginTop: spacing.sm },
  summary: { ...(typography.body as object), color: semantic.text.primary },
  section: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 2, marginTop: spacing.sm },
  flawBlock: { gap: spacing.sm },
  metricsCard: {
    backgroundColor: semantic.surface.raised,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  metricsGroup: {
    gap: spacing.xs,
  },
  metricsGroupTitle: {
    ...(typography.caption as object),
    color: semantic.text.muted,
    letterSpacing: 1.5,
    fontSize: 11,
    fontWeight: '800',
  },
  divider: { height: borderWidth.hairline, backgroundColor: semantic.border },
  disclaimer: { ...(typography.caption as object), color: semantic.text.muted, marginTop: spacing.md },
});
