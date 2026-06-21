import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { TrendingUp, TrendingDown, Minus, Target, Flag } from 'lucide-react-native';
import { semantic, spacing, radius, borderWidth, typography } from '../../src/ui/theme';
import { DrillCard } from '../../src/components/analysis';
import { TrendChart } from '../../src/components/TrendChart';
import {
  sinceLastUpload,
  primaryFlaw,
  trendSeries,
  personalBestIndex,
  nextCheckpoint,
  recommendedRetestCapture,
  flawIdToMetric,
  type MetricDelta,
} from '../../src/lib/briefing';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import type { AnalysisResult } from '../../src/types/analysis';

export default function CoachScreen() {
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalysisHistory()
      .then(setHistory)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  const deltas = useMemo(() => sinceLastUpload(history), [history]);
  const focus = useMemo(() => primaryFlaw(history), [history]);
  const focusRec = useMemo(
    () => history[history.length - 1]?.recommendations.find((r) => r.flawId === focus?.id),
    [history, focus]
  );
  const trackedKeys = useMemo(
    () => Array.from(new Set(history.flatMap((h) => h.metrics.map((m) => m.key)))),
    [history]
  );
  const checkpoint = nextCheckpoint(history.length);
  const focusMetricKey = focus ? flawIdToMetric(focus.id) : undefined;
  const retestCaptureHint = recommendedRetestCapture(focus?.id, focusMetricKey);

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
        <View style={styles.center} accessibilityLabel="briefing-error">
          <Text style={styles.body}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Coach Briefing</Text>

        <Text style={styles.section}>SINCE LAST UPLOAD</Text>
        {history.length < 2 ? (
          <View style={styles.card} accessibilityLabel="briefing-empty">
            <Text style={styles.body}>Upload a second run to see your deltas here.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {deltas.map((d) => (
              <DeltaRow key={d.key} delta={d} />
            ))}
          </View>
        )}

        <Text style={styles.section}>THIS WEEK'S FOCUS</Text>
        {focus ? (
          <View style={styles.focusWrap} accessibilityLabel="briefing-focus">
            <View style={styles.focusHeader}>
              <Target size={16} color={semantic.action.primary} />
              <Text style={styles.focusName}>{focus.name}</Text>
            </View>
            <Text style={styles.body}>{focus.plainExplanation}</Text>
            {focusRec ? <DrillCard rec={focusRec} testID={`focus-drill-${focusRec.drillId}`} /> : null}
            <Text style={styles.caption}>One focus at a time — technique change is slow and over-correction risks injury.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.body}>No flaw flagged on your latest run. Keep logging to track consistency.</Text>
          </View>
        )}

        <Text style={styles.section}>YOUR TREND</Text>
        {trackedKeys.map((key) => {
          const series = trendSeries(history, key);
          if (series.length === 0) return null;
          return <TrendChart key={key} series={series} pbIndex={personalBestIndex(series)} testID={`trend-${key}`} />;
        })}

        <Text style={styles.section}>NEXT CHECKPOINT</Text>
        <View style={styles.card} accessibilityLabel="briefing-checkpoint">
          <View style={styles.focusHeader}>
            <Flag size={16} color={semantic.action.primary} />
            <Text style={styles.body}>
              {checkpoint.due
                ? `Time to re-test your focus flaw — ${retestCaptureHint}`
                : `Re-test in ${checkpoint.sessionsLeft} more session${checkpoint.sessionsLeft === 1 ? '' : 's'}. ${retestCaptureHint}`}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DeltaRow({ delta }: { delta: MetricDelta }) {
  if (!delta.comparable) {
    return (
      <View style={styles.deltaRow} accessibilityLabel={`delta-${delta.key}-gated`}>
        <Text style={styles.deltaLabel}>{delta.label}</Text>
        <Text style={styles.deltaGated}>{delta.reason}</Text>
      </View>
    );
  }
  const color =
    delta.direction === 'improve'
      ? semantic.status.improve
      : delta.direction === 'regress'
        ? semantic.status.flaw
        : semantic.text.muted;
  const Icon = delta.direction === 'improve' ? TrendingUp : delta.direction === 'regress' ? TrendingDown : Minus;
  const sign = delta.delta > 0 ? '+' : '';
  return (
    <View style={styles.deltaRow} accessibilityLabel={`delta-${delta.key}`}>
      <Text style={styles.deltaLabel}>{delta.label}</Text>
      <View style={styles.deltaValue}>
        <Icon size={14} color={color} />
        <Text style={[styles.deltaNum, { color }]}>
          {sign}{delta.delta} {delta.unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: semantic.surface.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  title: { ...(typography.display as object), color: semantic.text.primary, marginTop: spacing.sm },
  section: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 2, marginTop: spacing.sm },
  card: {
    backgroundColor: semantic.surface.raised,
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  body: { ...(typography.body as object), color: semantic.text.primary, flex: 1 },
  caption: { ...(typography.caption as object), color: semantic.text.muted },
  focusWrap: { gap: spacing.md },
  focusHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  focusName: { ...(typography.title as object), color: semantic.text.primary },
  deltaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs, gap: spacing.md },
  deltaLabel: { ...(typography.bodyStrong as object), color: semantic.text.primary },
  deltaValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  deltaNum: { ...(typography.metricSmall as object), fontSize: 16 },
  deltaGated: { ...(typography.caption as object), color: semantic.text.muted, flex: 1, textAlign: 'right' },
});
