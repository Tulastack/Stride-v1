import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Video, TrendingUp, X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import type { AnalysisResult } from '../../src/types/analysis';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

export default function ProgressScreen() {
  const router = useRouter();
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisResult | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);

  useEffect(() => {
    fetchAnalysisHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const viewYear = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getFullYear();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getMonth();
  const { firstDay, daysInMonth } = getMonthData(viewYear, viewMonth);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Map each day of this month to analyses on that day
  const analysisMap = new Map<number, AnalysisResult[]>();
  history.forEach((a) => {
    const d = new Date(a.createdAt);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      if (!analysisMap.has(day)) analysisMap.set(day, []);
      analysisMap.get(day)!.push(a);
    }
  });

  // Find the best scoring day
  let bestDay: number | null = null;
  let bestScore = -1;
  analysisMap.forEach((analyses, day) => {
    analyses.forEach((a) => {
      const score = a.flaws.length === 0 ? 95 : Math.max(40, 100 - a.flaws.length * 10);
      if (score > bestScore) {
        bestScore = score;
        bestDay = day;
      }
    });
  });

  // Build grid cells (6 rows * 7 cols = 42 slots max)
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  const handleDayPress = (day: number) => {
    const analyses = analysisMap.get(day);
    if (analyses && analyses.length > 0) {
      // Show the latest analysis for that day
      setSelectedAnalysis(analyses[analyses.length - 1]);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#CDFF4F" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <TrendingUp color="#CDFF4F" size={24} />
          <Text style={styles.title}>PROGRESS</Text>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Video color="#8A8E97" size={48} />
            <Text style={styles.emptyTitle}>No analyses yet</Text>
            <Text style={styles.emptySubtitle}>Upload your first sprint video to start tracking progress</Text>
          </View>
        ) : (
          <>
            {/* Month navigation */}
            <View style={styles.monthNav}>
              <Pressable onPress={() => setMonthOffset((o) => o - 1)} hitSlop={12}>
                <ChevronLeft color="#ECE7DC" size={22} />
              </Pressable>
              <Text style={styles.monthLabel}>{monthLabel}</Text>
              <Pressable onPress={() => setMonthOffset((o) => o + 1)} hitSlop={12}>
                <ChevronRight color="#ECE7DC" size={22} />
              </Pressable>
            </View>

            {/* Day-of-week headers */}
            <View style={styles.dayHeaderRow}>
              {DAY_LABELS.map((d) => (
                <View key={d} style={styles.dayHeaderCell}>
                  <Text style={styles.dayHeaderText}>{d}</Text>
                </View>
              ))}
            </View>

            {/* Calendar grid */}
            <View style={styles.calendarGrid}>
              {cells.map((day, idx) => {
                const hasAnalysis = day !== null && analysisMap.has(day);
                const isBest = day !== null && day === bestDay;
                return (
                  <Pressable
                    key={idx}
                    style={styles.dayCell}
                    onPress={() => day !== null && hasAnalysis && handleDayPress(day)}
                    disabled={!hasAnalysis}
                  >
                    {day !== null && (
                      <View style={styles.dayCellInner}>
                        <View style={[styles.dayNumWrap, isBest && styles.dayNumWrapBest]}>
                          <Text style={[styles.dayNum, isBest && styles.dayNumBest, hasAnalysis && styles.dayNumActive]}>
                            {day}
                          </Text>
                        </View>
                        {hasAnalysis && !isBest && <View style={styles.dot} />}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={styles.legendDot} />
                <Text style={styles.legendText}>Has analysis</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.legendCircle} />
                <Text style={styles.legendText}>Best score</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Score Breakdown Modal */}
      <Modal visible={!!selectedAnalysis} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SCORE BREAKDOWN</Text>
              <Pressable onPress={() => setSelectedAnalysis(null)}>
                <X size={24} color="#ECE7DC" />
              </Pressable>
            </View>
            {selectedAnalysis && (
              <ScrollView style={styles.modalScroll}>
                <View style={styles.modalScore}>
                  <Text style={styles.modalScoreNum}>
                    {selectedAnalysis.flaws.length === 0 ? 95 : Math.max(40, 100 - selectedAnalysis.flaws.length * 10)}
                  </Text>
                  <Text style={styles.modalScoreLabel}>FORM SCORE</Text>
                </View>

                <Text style={styles.modalSection}>ISSUES FOUND</Text>
                {selectedAnalysis.flaws.length === 0 ? (
                  <Text style={styles.modalNoIssues}>No issues detected — great form!</Text>
                ) : (
                  selectedAnalysis.flaws.map((flaw) => (
                    <View key={flaw.id} style={styles.modalFlaw}>
                      <Text style={styles.modalFlawName}>{flaw.name.replace(/_/g, ' ')}</Text>
                      <Text style={styles.modalFlawDesc}>{flaw.plainExplanation}</Text>
                    </View>
                  ))
                )}

                {selectedAnalysis.recommendations && selectedAnalysis.recommendations.length > 0 && (
                  <>
                    <Text style={styles.modalSection}>RECOMMENDED DRILLS</Text>
                    {selectedAnalysis.recommendations.slice(0, 3).map((rec) => (
                      <View key={rec.drillId} style={styles.modalDrill}>
                        <Text style={styles.modalDrillName}>💪 {rec.drillName}</Text>
                        <Text style={styles.modalDrillDetail}>{rec.sets} sets × {rec.reps} reps — {rec.cue}</Text>
                      </View>
                    ))}
                  </>
                )}

                <Pressable
                  style={styles.modalViewFull}
                  onPress={() => {
                    setSelectedAnalysis(null);
                    router.push({ pathname: '/(tabs)/analysis', params: { analysisId: selectedAnalysis.id } });
                  }}
                >
                  <Text style={styles.modalViewFullText}>View Full Analysis →</Text>
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
  container: { flex: 1, backgroundColor: '#0E0F12' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#353A44' },
  title: { fontSize: 28, fontWeight: '900', color: '#ECE7DC', letterSpacing: -1 },

  // Empty state
  emptyState: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#ECE7DC' },
  emptySubtitle: { fontSize: 14, color: '#8A8E97', textAlign: 'center' },

  // Month navigation
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  monthLabel: { fontSize: 16, fontWeight: '800', color: '#ECE7DC', letterSpacing: 0.5 },

  // Day headers
  dayHeaderRow: { flexDirection: 'row', marginBottom: 8 },
  dayHeaderCell: { flex: 1, alignItems: 'center' },
  dayHeaderText: { fontSize: 11, fontWeight: '700', color: '#8A8E97', letterSpacing: 1 },

  // Calendar grid
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  dayCellInner: { alignItems: 'center', gap: 3 },
  dayNumWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumWrapBest: {
    backgroundColor: '#CDFF4F',
  },
  dayNum: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A8E97',
  },
  dayNumActive: {
    color: '#ECE7DC',
    fontWeight: '800',
  },
  dayNumBest: {
    color: '#0E0F12',
    fontWeight: '900',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CDFF4F',
  },

  // Legend
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#353A44',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#CDFF4F' },
  legendCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#CDFF4F' },
  legendText: { fontSize: 11, color: '#8A8E97', fontWeight: '600' },

  // Modal (unchanged)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#16181D', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%', padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#ECE7DC', letterSpacing: 1 },
  modalScroll: { flex: 1 },
  modalScore: { alignItems: 'center', marginBottom: 20 },
  modalScoreNum: { fontSize: 48, fontWeight: '900', color: '#CDFF4F', fontFamily: 'SpaceMono' },
  modalScoreLabel: { fontSize: 11, fontWeight: '700', color: '#8A8E97', letterSpacing: 2 },
  modalSection: { fontSize: 12, fontWeight: '900', color: '#ECE7DC', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  modalNoIssues: { fontSize: 14, color: '#5BE5A0', fontWeight: '600' },
  modalFlaw: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#353A44' },
  modalFlawName: { fontSize: 14, fontWeight: '700', color: '#ECE7DC', textTransform: 'capitalize' },
  modalFlawDesc: { fontSize: 12, color: '#B8B4AB', marginTop: 2 },
  modalDrill: { paddingVertical: 6 },
  modalDrillName: { fontSize: 14, fontWeight: '600', color: '#ECE7DC' },
  modalDrillDetail: { fontSize: 12, color: '#8A8E97', marginTop: 2 },
  modalViewFull: { marginTop: 20, paddingVertical: 14, backgroundColor: '#CDFF4F', alignItems: 'center', borderRadius: 8 },
  modalViewFullText: { fontSize: 14, fontWeight: '800', color: '#0E0F12' },
});
