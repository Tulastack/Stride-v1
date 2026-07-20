// PROMPT F.5 — Coach Briefing. Structured, data-driven, NO chat: the coach
// speaks through typed sections (deltas, focus, trend, checkpoint), never a
// free-text message stream. All copy is templated from analysis history.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius } from '../../src/theme';
import { TrendChart } from '../../src/components/TrendChart';
import {
  sinceLastUpload,
  primaryFlaw,
  trendSeries,
  personalBestIndex,
  nextCheckpoint,
  recommendedRetestCapture,
  flawIdToMetric,
} from '../../src/lib/briefing';
import type { AnalysisResult } from '../../src/types/analysis';

export default function CoachScreen() {
  const { colors } = useTheme();
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalysisHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const deltas = sinceLastUpload(history);
  const focus = primaryFlaw(history);
  const focusKey = flawIdToMetric(focus?.id);
  const checkpoint = nextCheckpoint(history.length);
  const latest = history[history.length - 1];
  const trendKeys = latest ? latest.metrics.map((m) => m.key) : [];

  const dirColor = (dir: 'improve' | 'regress' | 'flat') =>
    dir === 'improve' ? colors.success : dir === 'regress' ? colors.error : colors.muted;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, { color: colors.text }]}>Coach Briefing</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {history.length} sprint{history.length !== 1 ? 's' : ''} on file — no chat, just the numbers that moved.
        </Text>

        {/* ── SINCE LAST UPLOAD ── */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>SINCE LAST UPLOAD</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {deltas.length === 0 ? (
            <Text style={[styles.body, { color: colors.muted }]}>
              Upload a second sprint to see what changed.
            </Text>
          ) : (
            deltas.map((d) =>
              d.comparable ? (
                <Text
                  key={d.key}
                  accessibilityLabel={`delta-${d.key}`}
                  style={[styles.deltaRow, { color: dirColor(d.direction) }]}
                >
                  {d.label}: {d.delta > 0 ? '+' : ''}{d.delta}{d.unit} ({d.direction})
                </Text>
              ) : (
                <Text
                  key={d.key}
                  accessibilityLabel={`delta-${d.key}-gated`}
                  style={[styles.deltaRow, { color: colors.muted }]}
                >
                  {d.label}: not comparable yet — {d.reason}
                </Text>
              )
            )
          )}
        </View>

        {/* ── THIS WEEK'S FOCUS ── */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>THIS WEEK'S FOCUS</Text>
        <View
          accessibilityLabel="briefing-focus"
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          {focus ? (
            <>
              <Text style={[styles.focusName, { color: colors.text }]}>{focus.name}</Text>
              <Text style={[styles.body, { color: colors.muted }]}>{focus.plainExplanation}</Text>
              <Text style={[styles.tip, { color: colors.text }]}>
                {recommendedRetestCapture(focus.id, focusKey)}
              </Text>
            </>
          ) : (
            <Text style={[styles.body, { color: colors.success }]}>
              Nothing flagged — clean mechanics this week. Keep logging to hold the line.
            </Text>
          )}
        </View>

        {/* ── YOUR TREND ── */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>YOUR TREND</Text>
        <View style={styles.trends}>
          {trendKeys.map((key) => {
            const series = trendSeries(history, key);
            if (series.length === 0) return null;
            return <TrendChart key={key} series={series} pbIndex={personalBestIndex(series)} />;
          })}
        </View>

        {/* ── NEXT CHECKPOINT ── */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>NEXT CHECKPOINT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.body, { color: colors.text }]}>
            {checkpoint.due
              ? 'Checkpoint due — re-film your focus drill and upload to log progress.'
              : `${checkpoint.sessionsLeft} session${checkpoint.sessionsLeft !== 1 ? 's' : ''} until your next checkpoint.`}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: space.xl, paddingBottom: space.xxxl, gap: space.sm },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginBottom: space.lg },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1, marginTop: space.lg, marginBottom: space.xs },
  card: { padding: space.lg, borderWidth: 1, borderRadius: radius.md, gap: space.sm },
  body: { fontSize: 14, lineHeight: 20 },
  deltaRow: { fontSize: 15, fontWeight: '700' },
  focusName: { fontSize: 18, fontWeight: '800' },
  tip: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  trends: { gap: space.md },
});
