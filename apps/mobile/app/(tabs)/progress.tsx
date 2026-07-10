import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator, Pressable, Modal, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { TrendingUp, X } from 'lucide-react-native';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import { useTheme } from '../../src/context/ThemeContext';
import { space, radius, iconStroke } from '../../src/theme';
import type { AnalysisResult } from '../../src/types/analysis';

export default function ProgressScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisResult | null>(null);

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

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No analyses yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>Upload your first sprint to start tracking</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {history.map((analysis, index) => {
              const score = analysis.flaws.length === 0 ? 95 : Math.max(40, 100 - analysis.flaws.length * 10);
              const barWidth = `${(score / maxScore) * 100}%`;
              const date = new Date(analysis.createdAt || Date.now());
              const prev = index > 0 ? (history[index - 1].flaws.length === 0 ? 95 : Math.max(40, 100 - history[index - 1].flaws.length * 10)) : score;
              const delta = score - prev;

              return (
                <Pressable
                  key={analysis.id || index}
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
                    {selectedAnalysis.flaws.length === 0 ? 95 : Math.max(40, 100 - selectedAnalysis.flaws.length * 10)}
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
                  onPress={() => { setSelectedAnalysis(null); router.push({ pathname: '/(tabs)/analysis', params: { analysisId: selectedAnalysis.id } }); }}
                >
                  <Text style={[styles.modalViewFullText, { color: colors.accentText }]}>View Full Analysis →</Text>
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
  subtitle: { fontSize: 14, marginTop: space.xs },
  emptyState: { alignItems: 'center', marginTop: 80, gap: space.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
  list: { gap: space.md },
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
  modalContent: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '75%', padding: space.xl },
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
