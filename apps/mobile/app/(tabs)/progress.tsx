import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Video, TrendingUp } from 'lucide-react-native';
import { fetchAnalysisHistory } from '../../src/lib/analysisApi';
import type { AnalysisResult } from '../../src/types/analysis';

export default function ProgressScreen() {
  const router = useRouter();
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
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#000000" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TrendingUp color="#000000" size={24} />
          <Text style={styles.title}>PROGRESS</Text>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Video color="#CCCCCC" size={48} />
            <Text style={styles.emptyTitle}>No analyses yet</Text>
            <Text style={styles.emptySubtitle}>Upload your first sprint video to start tracking progress</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {history.map((analysis, index) => {
              const score = analysis.flaws.length === 0 ? 95 : Math.max(40, 100 - analysis.flaws.length * 10);
              const date = new Date(analysis.createdAt || Date.now());
              const improvement = index > 0 ? score - (history[index - 1].flaws.length === 0 ? 95 : Math.max(40, 100 - history[index - 1].flaws.length * 10)) : 0;

              return (
                <Pressable
                  key={analysis.id || index}
                  style={styles.logCard}
                  onPress={() => router.push({ pathname: '/(tabs)/analysis', params: { analysisId: analysis.id } })}
                >
                  <View style={styles.logLeft}>
                    <Text style={styles.logDate}>
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                    <Text style={styles.logTime}>
                      {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={styles.logCenter}>
                    <Text style={styles.logScore}>{score}</Text>
                    <Text style={styles.logScoreLabel}>score</Text>
                  </View>
                  <View style={styles.logRight}>
                    {improvement !== 0 && (
                      <Text style={[styles.logDelta, improvement > 0 ? styles.positive : styles.negative]}>
                        {improvement > 0 ? '+' : ''}{improvement}
                      </Text>
                    )}
                    <Text style={styles.logIssues}>{analysis.flaws.length} issues</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: '#000000' },
  title: { fontSize: 28, fontWeight: '900', color: '#000000', letterSpacing: -1 },
  emptyState: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#333333' },
  emptySubtitle: { fontSize: 14, color: '#888888', textAlign: 'center' },
  list: { gap: 8 },
  logCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#FAFAFA' },
  logLeft: { width: 70 },
  logDate: { fontSize: 14, fontWeight: '700', color: '#000000' },
  logTime: { fontSize: 11, color: '#888888' },
  logCenter: { flex: 1, alignItems: 'center' },
  logScore: { fontSize: 28, fontWeight: '900', color: '#000000' },
  logScoreLabel: { fontSize: 10, color: '#888888', letterSpacing: 1 },
  logRight: { alignItems: 'flex-end', width: 70 },
  logDelta: { fontSize: 14, fontWeight: '800' },
  positive: { color: '#059669' },
  negative: { color: '#DC2626' },
  logIssues: { fontSize: 11, color: '#888888', marginTop: 2 },
});
