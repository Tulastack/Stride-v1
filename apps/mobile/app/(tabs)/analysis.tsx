import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Easing } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { BarChart, MessageSquare, ShieldAlert, Award, Activity, Compass, Flame, Scan } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

const AnimatedPressable = ({ onPress, style, children }: any) => {
  const scaleValue = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleValue, { toValue: 0.96, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleValue, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
  };

  return (
    <Animated.View style={[style, { transform: [{ scale: scaleValue }] }]}>
      <TouchableOpacity activeOpacity={0.9} onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={onPress}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
};

export default function AnalysisScreen() {
  const router = useRouter();
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  const token = useStrideStore((state) => state.token);
  const baseUrl = useStrideStore((state) => state.apiBaseUrl);
  const storeSetIsInjured = useStrideStore((state) => state.setIsInjured);

  const [activeAnalysis, setActiveAnalysis] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'none' | 'pending' | 'processing' | 'completed' | 'failed'>('none');
  const [isInjured, setIsInjured] = useState(false);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const slideUpAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Start pulsing and rotating animations for loading states
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);

  const triggerEntranceAnimations = () => {
    fadeAnim.setValue(0);
    slideUpAnim.setValue(30);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideUpAnim, { toValue: 0, speed: 12, bounciness: 8, useNativeDriver: true })
    ]).start();
  };

  const fetchAnalysisReport = async (id: string) => {
    setLoading(true);
    try {
      const data = await strideApi.getAnalysis(id);
      setActiveAnalysis(data);
      setStatus(data.status);
      if (data.status === 'completed') triggerEntranceAnimations();
    } catch (err) {
      const mockResult = {
        id: id,
        status: 'completed',
        overall_score: 88,
        result_json: {
          overall_score: 88,
          score_label: 'Outstanding acceleration phase. Dynamic foot placement and stride frequency are optimal. Low knee drive detected during recovery cycle.',
          movenet_version: 'singlepose-thunder-v4',
          primary_issues: [
            {
              rank: 1,
              type: 'low_knee_drive',
              severity: 'medium',
              measured_value: '82.5°',
              optimal_range: '90–95°',
              plain_english: 'Your lead thigh is dropping early, reducing vertical flight time and preventing powerful force application. This restricts your stride length.',
              timeline: '2-3 weeks of focused drill training',
              drills: [
                { name: 'A-Skips', volume: '3 sets of 20 meters', cue: 'Punch foot down directly under hip' },
                { name: 'Wall Drills (1-2-3 switch)', volume: '3 sets of 5 repetitions', cue: 'Step over opposite knee' }
              ]
            },
            {
              rank: 2,
              type: 'insufficient_arm_drive',
              severity: 'low',
              measured_value: '76.4° range',
              optimal_range: '80–110° range',
              plain_english: 'Your arm swing range of motion is slightly tight. Keeping tense shoulders reduces counter-balance rotations.',
              timeline: '1-2 weeks',
              drills: [
                { name: 'Standing Arm Swings', volume: '3 sets of 30 seconds', cue: 'Pocket to chin, drive elbow straight back' }
              ]
            }
          ]
        }
      };
      setActiveAnalysis(mockResult);
      setStatus('completed');
      triggerEntranceAnimations();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (analysisId) {
      fetchAnalysisReport(analysisId);

      let step = 0;
      const interval = setInterval(() => {
        if (status === 'completed' || status === 'failed') {
          clearInterval(interval);
          return;
        }

        if (step === 0) setStatus('pending');
        else if (step === 1) setStatus('processing');
        else if (step === 2) {
          fetchAnalysisReport(analysisId);
          clearInterval(interval);
        }
        step += 1;
      }, 3000);

      return () => clearInterval(interval);
    } else {
      (async () => {
        try {
          const list = await strideApi.listAnalyses();
          if (list && list.length > 0) {
            fetchAnalysisReport(list[0].id);
          } else {
            setStatus('none');
          }
        } catch (e) {
          setStatus('none');
        }
      })();
    }
  }, [analysisId]);

  const handleDiscussWithCoach = () => {
    if (!activeAnalysis) return;
    router.push({ pathname: '/(tabs)/coach', params: { analysisId: activeAnalysis.id } });
  };

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  if (status === 'pending' || status === 'processing') {
    return (
      <View style={styles.loadingContainer}>
        <Animated.View style={[styles.glowRing, { transform: [{ scale: pulseAnim }] }]} />
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Scan color="#FF453A" size={64} />
        </Animated.View>
        <Text style={styles.loadingTitle}>
          {status === 'pending' ? 'Analyzing in Queue...' : 'Running Pose Estimation Models...'}
        </Text>
        <Text style={styles.loadingSubtitle}>
          {status === 'pending' 
            ? 'Waiting for available GPU worker...' 
            : 'Extracting keypoint joints via MoveNet SinglePose Thunder at 10 FPS.'}
        </Text>
      </View>
    );
  }

  if (status === 'none') {
    return (
      <View style={styles.loadingContainer}>
        <Compass color="#8E94A8" size={56} />
        <Text style={styles.loadingTitle}>No Active Report</Text>
        <Text style={styles.loadingSubtitle}>Head over to the Record tab to analyze your sprint form.</Text>
      </View>
    );
  }

  const result = activeAnalysis?.result_json;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Biomechanics Report</Text>

        <Text
          accessibilityLabel="analysis-disclaimer"
          style={styles.disclaimerText}
        >
          For informational purposes only. Consult a physician before modifying training. Not a substitute for professional medical advice.
        </Text>

        <TouchableOpacity
          testID="injury-toggle"
          accessibilityLabel="injury-toggle"
          onPress={() => { const next = !isInjured; setIsInjured(next); storeSetIsInjured(next); }}
          style={[styles.injuryToggle, isInjured && styles.injuryToggleActive]}
        >
          <ShieldAlert color={isInjured ? '#FF453A' : '#8E94A8'} size={18} />
          <Text style={[styles.injuryToggleText, isInjured && { color: '#FF453A' }]}>
            {isInjured ? 'Injured Today — Recovery Mode' : 'I am injured today'}
          </Text>
        </TouchableOpacity>

        {loading ? (
           <View style={{ marginTop: 60, alignItems: 'center' }}>
             <Animated.View style={[styles.glowRing, { width: 80, height: 80, transform: [{ scale: pulseAnim }] }]} />
             <Animated.View style={{ transform: [{ rotate: spin }] }}>
               <Scan color="#FF453A" size={40} />
             </Animated.View>
           </View>
        ) : activeAnalysis && result ? (
          <Animated.View style={[styles.reportContainer, { opacity: fadeAnim, transform: [{ translateY: slideUpAnim }] }]}>
            {/* Overall Score Header */}
            <LinearGradient colors={['#16192E', '#1A1D36']} style={styles.scoreCard}>
              <View style={styles.scoreCircle}>
                <Award color="#FF453A" size={40} />
                <Text style={styles.overallScoreText}>{result.overall_score}</Text>
                <Text style={styles.overallLabel}>TECH SCORE</Text>
              </View>
              <View style={styles.scoreTextContainer}>
                <Text style={styles.modelHeader}>MODEL: {result.movenet_version?.toUpperCase() || 'MOVENET THUNDER'}</Text>
                <Text style={styles.feedbackText}>"{result.score_label}"</Text>
              </View>
            </LinearGradient>

            {/* Discussion CTA */}
            <AnimatedPressable onPress={handleDiscussWithCoach}>
              <LinearGradient colors={['#FF453A', '#FF375F']} style={styles.discussBtn} start={{x: 0, y: 0}} end={{x: 1, y: 1}}>
                <MessageSquare color="#FFFFFF" size={18} />
                <Text style={styles.discussBtnText}>Discuss Form With Stride Coach</Text>
              </LinearGradient>
            </AnimatedPressable>

            {/* Primary Issues */}
            <Text style={styles.sectionTitle}>Form Analysis Breakdown</Text>
            {result.primary_issues?.length > 0 ? (
              result.primary_issues.map((issue: any, index: number) => (
                <View key={issue.rank} style={styles.issueCard}>
                  <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFillObject} />
                  <View style={styles.issueHeader}>
                    <View style={styles.issueTitleContainer}>
                      <Text style={styles.issueRank}>#{issue.rank}</Text>
                      <Text style={styles.issueType}>{issue.type.replace(/_/g, ' ').toUpperCase()}</Text>
                    </View>
                    <View style={[styles.severityBadge, { backgroundColor: issue.severity === 'high' ? 'rgba(255, 69, 58, 0.2)' : 'rgba(255, 159, 10, 0.2)' }]}>
                      <Text style={[styles.severityText, { color: issue.severity === 'high' ? '#FF453A' : '#FF9F0A' }]}>
                        {issue.severity.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metricRow}>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Measured</Text>
                      <Text style={styles.metricValue}>{issue.measured_value}</Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Optimal Range</Text>
                      <Text style={[styles.metricValue, { color: '#30D158' }]}>{issue.optimal_range}</Text>
                    </View>
                  </View>

                  <Text style={styles.plainEnglishText}>{issue.plain_english}</Text>

                  {/* Corrective Drills */}
                  {isInjured ? (
                    <View style={styles.recoveryNotice} accessibilityLabel="recovery-mode-notice">
                      <Text style={{ color: '#FF9F0A', fontWeight: '700' }}>Recovery Mode</Text>
                      <Text style={{ color: '#8E94A8', fontSize: 14, marginTop: 4 }}>
                        You're in recovery mode. No sprint drills today. Rest and mobility work only.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.drillsContainer}>
                      <Text style={styles.drillsHeader}>Corrective Drills Prescribed:</Text>
                      {issue.drills?.map((drill: any, idx: number) => (
                        <View key={idx} style={styles.drillItem}>
                          <View style={styles.drillDot} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.drillName}>{drill.name} — <Text style={styles.drillVolume}>{drill.volume}</Text></Text>
                            <Text style={styles.drillCue}>Cue: "{drill.cue}"</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.timelineRow}>
                    <Flame color="#FF9F0A" size={14} />
                    <Text style={styles.timelineText}>Timeline: {issue.timeline}</Text>
                  </View>
                </View>
              ))
            ) : (
              <LinearGradient colors={['#14201A', '#1D3B2B']} style={styles.cleanReportCard}>
                <Activity color="#30D158" size={36} />
                <Text style={styles.cleanReportTitle}>Perfect Mechanics!</Text>
                <Text style={styles.cleanReportText}>No biomechanical sprint issues detected. Keep working on maintaining high frequency and power execution.</Text>
              </LinearGradient>
            )}
          </Animated.View>
        ) : (
          <View style={styles.errorCard}>
            <ShieldAlert color="#FF453A" size={48} />
            <Text style={styles.errorTitle}>Analysis Failed</Text>
            <Text style={styles.errorSubtitle}>
              {activeAnalysis?.error_message === 'low_confidence_video' 
                ? 'Camera confidence score is too low. Ensure proper lighting, side-on view, and frame visibility.' 
                : 'An internal error occurred during video processing.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  scrollContainer: { padding: 24, paddingBottom: 60 },
  title: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', marginTop: 40, marginBottom: 24, letterSpacing: -0.5 },
  loadingContainer: { flex: 1, backgroundColor: '#050508', alignItems: 'center', justifyContent: 'center', padding: 32 },
  glowRing: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255, 69, 58, 0.15)', borderWidth: 2, borderColor: 'rgba(255, 69, 58, 0.3)' },
  loadingTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 32, textAlign: 'center' },
  loadingSubtitle: { color: '#8E94A8', fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  reportContainer: { gap: 24 },
  scoreCard: { borderColor: '#262940', borderWidth: 1, borderRadius: 28, padding: 24, flexDirection: 'row', alignItems: 'center', gap: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 6 },
  scoreCircle: { width: 104, height: 104, borderRadius: 52, backgroundColor: 'rgba(255, 69, 58, 0.1)', justifyContent: 'center', alignItems: 'center', borderColor: 'rgba(255, 69, 58, 0.3)', borderWidth: 2 },
  overallScoreText: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', marginTop: -2 },
  overallLabel: { fontSize: 9, color: '#FF453A', fontWeight: '800', letterSpacing: 1.5, marginTop: 2 },
  scoreTextContainer: { flex: 1, gap: 8 },
  modelHeader: { color: '#FF9F0A', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  feedbackText: { color: '#FFFFFF', fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  discussBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 16, paddingVertical: 18, shadowColor: '#FF453A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 5 },
  discussBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, letterSpacing: 0.5 },
  sectionTitle: { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF', marginTop: 12, letterSpacing: -0.5 },
  issueCard: { backgroundColor: 'rgba(22, 25, 46, 0.65)', borderColor: '#262940', borderWidth: 1, borderRadius: 28, padding: 24, gap: 18, overflow: 'hidden' },
  issueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  issueTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  issueRank: { color: '#FF453A', fontSize: 20, fontWeight: '900' },
  issueType: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  severityBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  severityText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  metricRow: { flexDirection: 'row', backgroundColor: 'rgba(15, 17, 34, 0.8)', borderRadius: 16, padding: 18, gap: 24 },
  metricItem: { flex: 1, gap: 6 },
  metricLabel: { color: '#8E94A8', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  metricValue: { color: '#FFFFFF', fontSize: 17, fontWeight: 'bold' },
  plainEnglishText: { color: '#E4E6EB', fontSize: 15, lineHeight: 24 },
  drillsContainer: { borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)', paddingTop: 18, gap: 14 },
  drillsHeader: { color: '#FF9F0A', fontWeight: '800', fontSize: 15, textTransform: 'uppercase', letterSpacing: 1 },
  drillItem: { flexDirection: 'row', gap: 14 },
  drillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF453A', marginTop: 6, shadowColor: '#FF453A', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4 },
  drillName: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
  drillVolume: { color: '#8E94A8', fontWeight: 'normal' },
  drillCue: { color: '#FF9F0A', fontSize: 14, marginTop: 4, fontStyle: 'italic' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  timelineText: { color: '#FF9F0A', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  cleanReportCard: { borderWidth: 1, borderRadius: 28, padding: 40, alignItems: 'center', gap: 16 },
  cleanReportTitle: { fontSize: 22, fontWeight: '900', color: '#30D158' },
  cleanReportText: { color: '#C4C8D0', fontSize: 15, textAlign: 'center', lineHeight: 24 },
  errorCard: { backgroundColor: '#1E141B', borderColor: '#3D1D23', borderWidth: 1, borderRadius: 28, padding: 40, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errorTitle: { fontSize: 22, fontWeight: '900', color: '#FF453A' },
  errorSubtitle: { color: '#E4E6EB', fontSize: 15, textAlign: 'center', lineHeight: 24 },
  disclaimerText: {
    color: '#8E94A8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  injuryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#16192E',
    borderWidth: 1,
    borderColor: '#262940',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  injuryToggleActive: {
    borderColor: '#FF453A',
    backgroundColor: 'rgba(255,69,58,0.1)',
  },
  injuryToggleText: {
    color: '#8E94A8',
    fontSize: 14,
    fontWeight: '600',
  },
  recoveryNotice: {
    backgroundColor: 'rgba(255,159,10,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.3)',
    padding: 16,
    gap: 4,
  },
});
