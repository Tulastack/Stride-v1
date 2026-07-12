import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator, Pressable, Modal, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { TrendingUp, X, Users, AlertTriangle } from 'lucide-react-native';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import { strideApi } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, iconStroke } from '../../src/theme';
import type { AnalysisResult } from '../../src/types/analysis';
import { TrendChart } from '../../src/components/progress/TrendChart';
import { pickRunnerOfTheDay } from '../../src/data/exampleRunners';

/** Real score for an analysis — the computed running-economy index when
 * available, falling back to a flaw-count heuristic (same formula as the
 * Analysis screen, see app/(tabs)/analysis.tsx). */
function scoreFor(analysis: AnalysisResult): number {
  return analysis.economyScore ?? (analysis.flaws.length === 0 ? 95 : Math.max(40, 100 - analysis.flaws.length * 10));
}

const TRACKED_METRICS = ['knee_drive', 'cadence_spm'];
const METRIC_LABELS: Record<string, string> = { knee_drive: 'Knee drive', cadence_spm: 'Cadence' };

/** Short trend sentence derived from the already-loaded history — compares
 * the average score of the most recent sprints against the earliest ones. */
function improvementSummary(history: AnalysisResult[]): string {
  if (history.length < 2) return 'Log a couple more sprints to start seeing a trend.';
  const scores = history.map(scoreFor);
  const windowSize = Math.min(3, Math.floor(scores.length / 2)) || 1;
  const earlierAvg = scores.slice(0, windowSize).reduce((a, b) => a + b, 0) / windowSize;
  const recentAvg = scores.slice(-windowSize).reduce((a, b) => a + b, 0) / windowSize;
  const delta = Math.round(recentAvg - earlierAvg);
  if (delta > 2) return `Trending up — your form score is averaging ${delta} points higher than when you started.`;
  if (delta < -2) return `Your form score has dipped ${Math.abs(delta)} points recently — worth a look at what changed.`;
  return `Your form score has stayed steady over your last ${scores.length} sprints.`;
}

interface RecurringIssue {
  name: string;
  count: number;
  explanation: string;
}

/** Aggregates flaws by name across every analysis (not just the latest),
 * ranked by how severe and how frequent they are, so the athlete sees what
 * actually keeps coming up rather than a single run's snapshot. */
function topRecurringIssues(history: AnalysisResult[]): RecurringIssue[] {
  const byName = new Map<string, { count: number; totalSeverity: number; explanation: string }>();
  for (const analysis of history) {
    for (const flaw of analysis.flaws) {
      const entry = byName.get(flaw.name) ?? { count: 0, totalSeverity: 0, explanation: flaw.plainExplanation };
      entry.count += 1;
      entry.totalSeverity += flaw.severity;
      entry.explanation = flaw.plainExplanation; // keep the most recent wording
      byName.set(flaw.name, entry);
    }
  }
  return [...byName.entries()]
    .map(([name, v]) => ({ name, count: v.count, avgSeverity: v.totalSeverity / v.count, explanation: v.explanation }))
    .sort((a, b) => b.avgSeverity * b.count - a.avgSeverity * a.count)
    .slice(0, 3)
    .map(({ name, count, explanation }) => ({ name, count, explanation }));
}

export default function ProgressScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisResult | null>(null);
  const [view, setView] = useState<'history' | 'insights'>('history');
  const [metrics, setMetrics] = useState<Record<string, { value: number }[]> | null>(null);

  useEffect(() => {
    fetchAnalysisHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load metric trend data the first time Insights is opened.
  useEffect(() => {
    if (view !== 'insights' || metrics) return;
    strideApi.getMetrics(90).then(setMetrics).catch(() => setMetrics({}));
  }, [view, metrics]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const maxScore = 100;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Big title */}
        <View style={styles.titleBlock}>
          <TrendingUp size={28} color={colors.accent} strokeWidth={iconStroke} />
          <Text style={[styles.title, { color: colors.text }]}>Your{'\n'}Progress</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{history.length} sprint{history.length !== 1 ? 's' : ''} analyzed</Text>
        </View>

        {/* Top segmented view — History (default) vs. Insights, Progress tab only */}
        <View style={styles.segmentRow}>
          <Pressable
            accessibilityLabel="progress-view-history"
            onPress={() => setView('history')}
            style={[styles.segmentChip, { borderColor: view === 'history' ? colors.accent : colors.border, backgroundColor: view === 'history' ? colors.accent : 'transparent' }]}
          >
            <Text style={[styles.segmentText, { color: view === 'history' ? colors.accentText : colors.text }]}>History</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="progress-view-insights"
            onPress={() => setView('insights')}
            style={[styles.segmentChip, { borderColor: view === 'insights' ? colors.accent : colors.border, backgroundColor: view === 'insights' ? colors.accent : 'transparent' }]}
          >
            <Text style={[styles.segmentText, { color: view === 'insights' ? colors.accentText : colors.text }]}>Insights</Text>
          </Pressable>
        </View>

        {view === 'insights' ? (
          <View style={styles.list}>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryText, { color: colors.text }]}>{improvementSummary(history)}</Text>
            </View>

            {history.length >= 2 && (
              <TrendChart
                title="Form score over time"
                points={history.map(scoreFor)}
                color={colors.accent}
                mutedColor={colors.muted}
                cardColor={colors.card}
                borderColor={colors.border}
                textColor={colors.text}
              />
            )}

            {TRACKED_METRICS.map((key) => {
              const rows = metrics?.[key];
              if (!rows || rows.length < 2) return null;
              const points = [...rows].reverse().map((r) => r.value);
              return (
                <TrendChart
                  key={key}
                  title={METRIC_LABELS[key] ?? key}
                  points={points}
                  color={colors.accent}
                  mutedColor={colors.muted}
                  cardColor={colors.card}
                  borderColor={colors.border}
                  textColor={colors.text}
                />
              );
            })}

            {topRecurringIssues(history).length > 0 && (
              <>
                <View style={styles.runnersHeader}>
                  <AlertTriangle size={16} color={colors.accent} strokeWidth={iconStroke} />
                  <Text style={[styles.runnersTitle, { color: colors.text }]}>TOP ISSUES ACROSS YOUR SPRINTS</Text>
                </View>
                {topRecurringIssues(history).map((issue) => (
                  <View key={issue.name} style={[styles.runnerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.issueTop}>
                      <Text style={[styles.runnerName, { color: colors.text }]}>{issue.name.replace(/_/g, ' ')}</Text>
                      <Text style={[styles.issueCount, { color: colors.muted }]}>
                        {issue.count} of {history.length} sprint{history.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.runnerNote, { color: colors.muted }]}>{issue.explanation}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={styles.runnersHeader}>
              <Users size={16} color={colors.accent} strokeWidth={iconStroke} />
              <Text style={[styles.runnersTitle, { color: colors.text }]}>RUNNER TO WATCH</Text>
            </View>
            {(() => {
              const runner = pickRunnerOfTheDay();
              return (
                <View style={[styles.runnerSpotlight, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
                  <Text style={[styles.runnerName, { color: colors.text }]}>{runner.name} · {runner.specialty}</Text>
                  <Text style={[styles.runnerNote, { color: colors.muted }]}>{runner.formNote}</Text>
                </View>
              );
            })()}
          </View>
        ) : history.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No analyses yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>Upload your first sprint to start tracking</Text>
            <Pressable
              accessibilityLabel="retest-cta"
              onPress={() => router.push('/(tabs)/')}
              style={[styles.retestCta, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.retestCtaText, { color: colors.accentText }]}>Record a sprint</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            <Pressable
              accessibilityLabel="retest-cta"
              onPress={() => router.push('/(tabs)/')}
              style={[styles.retestCta, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.retestCtaText, { color: colors.accentText }]}>Record another sprint</Text>
            </Pressable>
            {history.map((analysis, index) => {
              const score = scoreFor(analysis);
              const barWidth = `${(score / maxScore) * 100}%`;
              const date = new Date(analysis.createdAt || Date.now());
              const prev = index > 0 ? scoreFor(history[index - 1]) : score;
              const delta = score - prev;

              return (
                <Pressable
                  key={analysis.id || index}
                  accessibilityLabel={`progress-log-${analysis.id || index}`}
                  style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setSelectedAnalysis(analysis)}
                >
                  <View style={styles.logTop}>
                    <Text style={[styles.logDate, { color: colors.text }]}>
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                    <View style={styles.logScoreRow}>
                      <Text style={[styles.logScore, { color: colors.accent }]}>{score}</Text>
                      {delta !== 0 && index > 0 && (
                        <Text style={[styles.logDelta, delta > 0 ? { color: colors.success } : { color: colors.error }]}>
                          {delta > 0 ? '+' : ''}{delta}
                        </Text>
                      )}
                    </View>
                  </View>
                  {/* Score bar */}
                  <View style={[styles.barBg, { backgroundColor: colors.cardAlt }]}>
                    <View style={[styles.barFill, { width: barWidth as any, backgroundColor: colors.accent }]} />
                  </View>
                  <Text style={[styles.logIssues, { color: colors.muted }]}>{analysis.flaws.length} issue{analysis.flaws.length !== 1 ? 's' : ''} detected</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Score Breakdown Modal */}
      <Modal visible={!!selectedAnalysis} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>SCORE BREAKDOWN</Text>
              <Pressable onPress={() => setSelectedAnalysis(null)}>
                <X size={24} color={colors.text} />
              </Pressable>
            </View>
            {selectedAnalysis && (
              <ScrollView>
                <View style={styles.modalScore}>
                  <Text style={[styles.modalScoreNum, { color: colors.accent }]}>
                    {scoreFor(selectedAnalysis)}
                  </Text>
                  <Text style={[styles.modalScoreLabel, { color: colors.muted }]}>FORM SCORE</Text>
                </View>

                {selectedAnalysis.flaws.length === 0 ? (
                  <Text style={[styles.modalNoIssues, { color: colors.success }]}>No issues — great form!</Text>
                ) : (
                  selectedAnalysis.flaws.map((flaw) => (
                    <View key={flaw.id} style={[styles.modalFlaw, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.modalFlawName, { color: colors.text }]}>{flaw.name.replace(/_/g, ' ')}</Text>
                      <Text style={[styles.modalFlawDesc, { color: colors.muted }]}>{flaw.plainExplanation}</Text>
                    </View>
                  ))
                )}

                <Pressable
                  style={[styles.modalViewFull, { backgroundColor: colors.accent }]}
                  onPress={() => setSelectedAnalysis(null)}
                >
                  <Text style={[styles.modalViewFullText, { color: colors.accentText }]}>Close</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: space.xl, paddingBottom: space.xxxl },
  titleBlock: { marginBottom: space.xxl, gap: space.xs },
  title: { fontSize: 36, fontWeight: '900', letterSpacing: -1, lineHeight: 42 },
  segmentRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.xl },
  segmentChip: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderWidth: 1, borderRadius: radius.pill },
  segmentText: { fontSize: 13, fontWeight: '800' },
  summaryCard: { padding: space.lg, borderWidth: 1, borderRadius: radius.md, marginBottom: space.md },
  summaryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  runnersHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, marginBottom: space.sm },
  runnersTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  runnerCard: { padding: space.lg, borderWidth: 1, borderRadius: radius.md, marginBottom: space.sm, gap: 4 },
  runnerName: { fontSize: 14, fontWeight: '800' },
  runnerNote: { fontSize: 13, lineHeight: 18 },
  runnerSpotlight: { padding: space.lg, borderWidth: 1.5, borderRadius: radius.md, marginBottom: space.md, gap: 4 },
  issueTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  issueCount: { fontSize: 11, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: space.xs },
  emptyState: { alignItems: 'center', marginTop: 80, gap: space.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
  list: { gap: space.md },
  retestCta: { paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.sm, alignItems: 'center', marginBottom: space.sm },
  retestCtaText: { fontSize: 14, fontWeight: '800' },
  logCard: { padding: space.lg, borderWidth: 1, borderRadius: radius.md, gap: space.sm },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logDate: { fontSize: 14, fontWeight: '600' },
  logScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  logScore: { fontSize: 28, fontWeight: '900' },
  logDelta: { fontSize: 14, fontWeight: '700' },
  barBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  logIssues: { fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '75%', padding: space.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xl },
  modalTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  modalScore: { alignItems: 'center', marginBottom: space.xl },
  modalScoreNum: { fontSize: 48, fontWeight: '900' },
  modalScoreLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  modalNoIssues: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  modalFlaw: { paddingVertical: space.md, borderBottomWidth: 1 },
  modalFlawName: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  modalFlawDesc: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  modalViewFull: { marginTop: space.xl, paddingVertical: 14, alignItems: 'center', borderRadius: radius.sm },
  modalViewFullText: { fontSize: 14, fontWeight: '800' },
});
