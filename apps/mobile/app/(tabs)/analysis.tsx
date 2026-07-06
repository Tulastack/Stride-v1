import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, SafeAreaView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AlertTriangle, ChevronRight, Target } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { parseAnalysisResult, waitForAnalysisResult, type AnalysisRow } from '../../src/lib/analysisApi';
import { PoseVideoPlayer } from '../../src/components/analysis/PoseVideoPlayer';
import type { AnalysisResult, Flaw } from '../../src/types/analysis';

type Status = 'pending' | 'processing' | 'failed' | 'done';

const SEVERITY_LABELS: Record<number, { label: string; color: string }> = {
  5: { label: 'MAJOR', color: '#DC2626' },
  4: { label: 'SIGNIFICANT', color: '#EA580C' },
  3: { label: 'MODERATE', color: '#D97706' },
  2: { label: 'MINOR', color: '#CA8A04' },
  1: { label: 'MINOR', color: '#65A30D' },
};

function getSeverityInfo(index: number, total: number): { label: string; color: string } {
  if (total <= 1) return SEVERITY_LABELS[3];
  const severity = Math.max(1, 5 - index);
  return SEVERITY_LABELS[severity] || SEVERITY_LABELS[3];
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

export default function AnalysisScreen() {
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id?: string) => {
    if (!id) { setStatus('failed'); setError('No analysis ID provided.'); return; }
    setStatus('pending');
    setError(null);
    setResult(null);

    try {
      const row = (await strideApi.getAnalysis(id)) as AnalysisRow;
      if (row.status === 'failed') { setStatus('failed'); setError(row.error_message ?? 'Analysis failed.'); return; }
      if (row.status === 'completed') {
        const parsed = parseAnalysisResult(row);
        if (!parsed) { setStatus('failed'); setError('Result is missing or invalid.'); return; }
        setResult(parsed); setStatus('done'); return;
      }
      setStatus('processing');
      const outcome = await waitForAnalysisResult(id, { intervalMs: 2000, timeoutMs: 180_000 });
      if (outcome.status === 'completed' && outcome.result) { setResult(outcome.result); setStatus('done'); }
      else { setStatus('failed'); setError(outcome.error ?? 'Analysis did not complete.'); }
    } catch (e: unknown) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Could not load analysis.');
    }
  }, []);

  useEffect(() => { load(analysisId); }, [analysisId, load]);

  // Limit to top 5 flaws sorted by severity
  const topFlaws = useMemo(() => {
    if (!result) return [];
    return [...result.flaws].sort((a, b) => b.severity - a.severity).slice(0, 5);
  }, [result]);

  if (status === 'pending' || status === 'processing') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>
            {status === 'processing' ? 'Analyzing your sprint...' : 'Loading...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'failed' || !result) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.failTitle}>Analysis Failed</Text>
          <Text style={styles.failMsg}>{friendlyError(error)}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load(analysisId)}>
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Skeleton overlay video */}
        {analysisId ? (
          <PoseVideoPlayer analysisId={analysisId} seekToMs={topFlaws[0]?.evidence?.frameTimestampMs} />
        ) : null}

        {/* Score */}
        <View style={styles.scoreSection}>
          <Text style={styles.scoreNumber}>{result.flaws.length === 0 ? 95 : Math.max(40, 100 - result.flaws.length * 10)}</Text>
          <Text style={styles.scoreLabel}>FORM SCORE</Text>
        </View>

        <Text style={styles.summary}>{result.summary}</Text>

        {/* Issues */}
        {topFlaws.length > 0 && (
          <View style={styles.issuesSection}>
            <Text style={styles.sectionTitle}>AREAS TO IMPROVE</Text>
            {topFlaws.map((flaw, index) => {
              const severity = getSeverityInfo(index, topFlaws.length);
              return (
                <View key={flaw.id} style={styles.issueCard}>
                  <View style={styles.issueHeader}>
                    <View style={[styles.severityBadge, { backgroundColor: severity.color }]}>
                      <Text style={styles.severityText}>{severity.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.issueTitle}>{flaw.name.replace(/_/g, ' ')}</Text>
                  <Text style={styles.issueDesc}>{flaw.plainExplanation}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Drills - minimal */}
        {result.recommendations && result.recommendations.length > 0 && (
          <View style={styles.drillsSection}>
            <Text style={styles.sectionTitle}>QUICK FIXES</Text>
            {result.recommendations.slice(0, 3).map((rec) => (
              <View key={rec.drillId} style={styles.drillItem}>
                <Target size={16} color="#4F46E5" />
                <View style={styles.drillInfo}>
                  <Text style={styles.drillName}>{rec.drillName}</Text>
                  <Text style={styles.drillVolume}>{rec.sets} sets × {rec.reps} reps</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* CTA to AI Coach */}
        <Pressable
          style={styles.coachCta}
          onPress={() => router.push('/(tabs)/coach')}
        >
          <View style={styles.coachCtaContent}>
            <Text style={styles.coachCtaTitle}>Want personalized tips?</Text>
            <Text style={styles.coachCtaSubtitle}>Chat with AI Coach for drills, workout plans, and more</Text>
          </View>
          <ChevronRight size={20} color="#4F46E5" />
        </Pressable>

        <Text style={styles.disclaimer}>
          Results are based on 2D video analysis. For best accuracy, film from the side in good lighting.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { fontSize: 14, fontWeight: '600', color: '#666666', marginTop: 8 },
  failTitle: { fontSize: 20, fontWeight: '800', color: '#DC2626' },
  failMsg: { fontSize: 14, color: '#666666', textAlign: 'center' },
  retryBtn: { borderWidth: 2, borderColor: '#000000', paddingVertical: 12, paddingHorizontal: 24, marginTop: 12 },
  retryText: { fontSize: 14, fontWeight: '800', color: '#000000' },
  scroll: { padding: 24, paddingBottom: 48 },
  scoreSection: { alignItems: 'center', marginBottom: 20 },
  scoreNumber: { fontSize: 56, fontWeight: '900', color: '#000000' },
  scoreLabel: { fontSize: 12, fontWeight: '700', color: '#666666', letterSpacing: 2 },
  summary: { fontSize: 15, color: '#333333', lineHeight: 22, marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '900', color: '#000000', letterSpacing: 1.5, marginBottom: 12 },
  issuesSection: { marginBottom: 24 },
  issueCard: { backgroundColor: '#F9F9F9', padding: 16, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: '#E5E5E5' },
  issueHeader: { flexDirection: 'row', marginBottom: 6 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3 },
  severityText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  issueTitle: { fontSize: 16, fontWeight: '700', color: '#000000', textTransform: 'capitalize', marginBottom: 4 },
  issueDesc: { fontSize: 13, color: '#555555', lineHeight: 19 },
  issueStat: { fontSize: 12, color: '#888888', marginTop: 4, fontStyle: 'italic' },
  drillsSection: { marginBottom: 24 },
  drillItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  drillInfo: { flex: 1 },
  drillName: { fontSize: 14, fontWeight: '700', color: '#000000' },
  drillVolume: { fontSize: 12, color: '#666666', marginTop: 2 },
  coachCta: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F0FF', padding: 16, borderRadius: 8, marginBottom: 24 },
  coachCtaContent: { flex: 1 },
  coachCtaTitle: { fontSize: 15, fontWeight: '700', color: '#4F46E5' },
  coachCtaSubtitle: { fontSize: 12, color: '#666666', marginTop: 2 },
  disclaimer: { fontSize: 11, color: '#AAAAAA', textAlign: 'center' },
});
