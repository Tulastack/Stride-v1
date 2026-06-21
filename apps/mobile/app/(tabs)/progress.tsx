import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, ActivityIndicator } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../../src/ui/theme';
import { TrendChart } from '../../src/components/TrendChart';
import {
  trendSeries,
  personalBestIndex,
  deltaVsBaseline,
  nextCheckpoint,
  primaryFlaw,
  recommendedRetestCapture,
  flawIdToMetric,
} from '../../src/lib/briefing';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import type { AnalysisResult } from '../../src/types/analysis';

export default function ProgressScreen() {
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareToFirst, setCompareToFirst] = useState(false);

  useEffect(() => {
    fetchAnalysisHistory()
      .then(setHistory)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  const trackedKeys = useMemo(
    () => Array.from(new Set(history.flatMap((h) => h.metrics.map((m) => m.key)))),
    [history]
  );
  const checkpoint = nextCheckpoint(history.length);
  const focus = primaryFlaw(history);
  const retestCaptureHint = recommendedRetestCapture(focus?.id, focus ? flawIdToMetric(focus.id) : undefined);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={semantic.action.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center} accessibilityLabel="progress-error">
          <Text style={styles.body}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (history.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.empty} accessibilityLabel="progress-empty">
          <Text style={styles.body}>Upload your first run to start tracking progress.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Progress</Text>

        <Pressable
          style={[styles.toggle, compareToFirst && styles.toggleOn]}
          onPress={() => setCompareToFirst((v) => !v)}
          testID="compare-first-toggle"
          accessibilityLabel="compare-first-toggle"
        >
          <Text style={[styles.toggleText, compareToFirst && styles.toggleTextOn]}>
            {compareToFirst ? 'Comparing to first upload' : 'Compare to first upload'}
          </Text>
        </Pressable>

        {trackedKeys.map((key) => {
          const series = trendSeries(history, key);
          if (series.length === 0) return null;
          const pb = personalBestIndex(series);
          const baseline = deltaVsBaseline(history, key);
          return (
            <View key={key} style={styles.block}>
              <TrendChart series={series} pbIndex={pb} testID={`progress-trend-${key}`} />
              {compareToFirst && baseline ? (
                <Text
                  style={[
                    styles.baseline,
                    {
                      color: baseline.comparable
                        ? baseline.direction === 'improve'
                          ? semantic.status.improve
                          : baseline.direction === 'regress'
                            ? semantic.status.flaw
                            : semantic.text.muted
                        : semantic.text.muted,
                    },
                  ]}
                  accessibilityLabel={`baseline-${key}`}
                >
                  {baseline.comparable
                    ? `${baseline.delta > 0 ? '+' : ''}${baseline.delta} ${baseline.unit} vs first upload`
                    : baseline.reason}
                </Text>
              ) : null}
            </View>
          );
        })}

        <View style={styles.retestCard} accessibilityLabel="retest-cta">
          <RotateCcw size={16} color={semantic.action.primary} />
          <Text style={styles.body}>
            {checkpoint.due
              ? `Re-test your focus flaw — ${retestCaptureHint}`
              : `Re-test in ${checkpoint.sessionsLeft} more session${checkpoint.sessionsLeft === 1 ? '' : 's'}. ${retestCaptureHint}`}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: semantic.surface.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  title: { ...(typography.display as object), color: semantic.text.primary, marginTop: spacing.sm },
  toggle: {
    alignSelf: 'flex-start',
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  toggleOn: { borderColor: semantic.action.primary, backgroundColor: semantic.surface.raised },
  toggleText: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 1 },
  toggleTextOn: { color: semantic.action.primary },
  block: { gap: spacing.xs },
  baseline: { ...(typography.metricSmall as object), fontSize: 13, paddingHorizontal: spacing.xs },
  body: { ...(typography.body as object), color: semantic.text.primary, flex: 1 },
  retestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: semantic.surface.raised,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
});
