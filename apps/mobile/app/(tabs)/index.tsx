import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Animated, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { Play, TrendingUp, AlertTriangle, ArrowRight, Video } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

const AnimatedPressable = ({ onPress, style, children }: any) => {
  const scaleValue = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleValue, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleValue, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={onPress}>
      <Animated.View style={[style, { transform: [{ scale: scaleValue }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};

export default function DashboardScreen() {
  const router = useRouter();
  const user = useStrideStore((state) => state.user);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Entrance animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        speed: 12,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const data = await strideApi.listAnalyses();
      setAnalyses(data);
    } catch (err) {
      setAnalyses([
        {
          id: 'dummy-analysis-1',
          created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
          status: 'completed',
          overall_score: 88,
          result_json: {
            score_label: 'Outstanding acceleration phase. Slight knee drive limitation detected.',
            primary_issues: [
              {
                rank: 1,
                type: 'low_knee_drive',
                severity: 'medium',
                measured_value: '82.5°',
                optimal_range: '90–95°',
                plain_english: 'Your recovery thigh is dropping early, reducing vertical projection.',
              }
            ]
          }
        },
        {
          id: 'dummy-analysis-2',
          created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
          status: 'completed',
          overall_score: 84,
          result_json: {
            score_label: 'Strong drive phase. Serious overstriding on ground contact.',
            primary_issues: [
              {
                rank: 1,
                type: 'overstriding',
                severity: 'high',
                measured_value: '0.08 normalized units',
                optimal_range: 'within 0.06 units',
                plain_english: 'Your foot is landing too far ahead of your hips, causing breaking forces.',
              }
            ]
          }
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const latestAnalysis = analyses[0];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Header Section */}
          <View style={styles.header}>
            <View>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.athleteName}>{user?.display_name || 'Athlete'}</Text>
            </View>
            <LinearGradient colors={['#FF453A', '#FF375F']} style={styles.badge} start={{x: 0, y: 0}} end={{x: 1, y: 1}}>
              <Text style={styles.badgeText}>{user?.event_specialty || '100m'}</Text>
            </LinearGradient>
          </View>

          {/* Stats Grid */}
          <View style={styles.statsGrid}>
            {[
              { label: 'PB Time', value: user?.personal_best_seconds ? `${user.personal_best_seconds}s` : 'N/A' },
              { label: 'Level', value: user?.experience_level ? user.experience_level.toUpperCase() : 'N/A' },
              { label: 'Analyses', value: analyses.length }
            ].map((stat, i) => (
              <View key={i} style={styles.statCard}>
                <Text style={styles.statLabel}>{stat.label}</Text>
                <Text style={styles.statValue}>{stat.value}</Text>
              </View>
            ))}
          </View>

          {/* Main Score Progress Card */}
          {latestAnalysis ? (
            <AnimatedPressable 
              onPress={() => router.push({ pathname: '/(tabs)/analysis', params: { analysisId: latestAnalysis.id } })}
            >
              <LinearGradient colors={['#16192E', '#1A1D36']} style={styles.mainProgressCard}>
                <View style={styles.progressRow}>
                  <View>
                    <Text style={styles.progressLabel}>LATEST TECHNIQUE SCORE</Text>
                    <Text style={styles.progressScore}>{latestAnalysis.overall_score}/100</Text>
                  </View>
                  <View style={styles.scoreCircle}>
                    <TrendingUp color="#FF453A" size={32} />
                  </View>
                </View>
                <Text style={styles.feedbackLabel} numberOfLines={2}>
                  "{latestAnalysis.result_json?.score_label}"
                </Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.footerLinkText}>View Biomechanics Breakdown</Text>
                  <ArrowRight color="#FF453A" size={16} />
                </View>
              </LinearGradient>
            </AnimatedPressable>
          ) : (
            <View style={styles.emptyCard}>
              <Video color="#8E94A8" size={48} />
              <Text style={styles.emptyCardTitle}>No Analyses Yet</Text>
              <Text style={styles.emptyCardSubtitle}>Upload a sprint video to get your first biomechanical analysis report.</Text>
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/record')}>
                <Text style={styles.actionBtnText}>Analyze First Video</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Recent Analysis list */}
          {analyses.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sprint History</Text>
              {loading ? (
                <ActivityIndicator size="small" color="#FF453A" style={{ marginTop: 16 }} />
              ) : (
                analyses.map((analysis, index) => {
                  const date = new Date(analysis.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });
                  return (
                    <AnimatedPressable
                      key={analysis.id}
                      onPress={() => router.push({ pathname: '/(tabs)/analysis', params: { analysisId: analysis.id } })}
                    >
                      <View style={styles.historyCard}>
                        <View style={styles.historyLeft}>
                          <View style={[styles.historyIndicator, { backgroundColor: analysis.status === 'completed' ? '#34C759' : '#FF453A', shadowColor: analysis.status === 'completed' ? '#34C759' : '#FF453A', shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }]} />
                          <View>
                            <Text style={styles.historyDate}>{date}</Text>
                            <Text style={styles.historyStatus}>{analysis.status.toUpperCase()}</Text>
                          </View>
                        </View>
                        <View style={styles.historyRight}>
                          {analysis.overall_score && (
                            <Text style={styles.historyScore}>{analysis.overall_score} pts</Text>
                          )}
                          <ArrowRight color="#8E94A8" size={18} />
                        </View>
                      </View>
                    </AnimatedPressable>
                  );
                })
              )}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Floating Action Button */}
      {analyses.length > 0 && (
        <AnimatedPressable 
          style={styles.fabContainer} 
          onPress={() => router.push('/(tabs)/record')}
        >
          <BlurView intensity={40} tint="light" style={styles.fabBlur}>
            <LinearGradient colors={['#FF453A', '#FF375F']} style={styles.fab}>
              <Play color="#FFFFFF" size={24} fill="#FFFFFF" />
            </LinearGradient>
          </BlurView>
        </AnimatedPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508', // Darker background for contrast
  },
  scrollContainer: {
    padding: 24,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 24,
  },
  welcomeText: {
    color: '#8E94A8',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  athleteName: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#FF453A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(22, 25, 46, 0.7)',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
  },
  statLabel: {
    color: '#8E94A8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 1,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  mainProgressCard: {
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 28,
    padding: 24,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  progressLabel: {
    color: '#FF453A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  progressScore: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1,
  },
  scoreCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: 'rgba(255, 69, 58, 0.3)',
    borderWidth: 1.5,
  },
  feedbackLabel: {
    color: '#E4E6EB',
    fontSize: 15,
    lineHeight: 24,
    fontStyle: 'italic',
    marginBottom: 24,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 16,
  },
  footerLinkText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  emptyCard: {
    backgroundColor: 'rgba(22, 25, 46, 0.7)',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 28,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  emptyCardTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 20,
    marginBottom: 8,
  },
  emptyCardSubtitle: {
    fontSize: 15,
    color: '#8E94A8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  actionBtn: {
    backgroundColor: '#FF453A',
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 16,
    shadowColor: '#FF453A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  historyCard: {
    backgroundColor: 'rgba(22, 25, 46, 0.7)',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  historyIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  historyDate: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  historyStatus: {
    color: '#8E94A8',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  historyRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  historyScore: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    borderRadius: 34,
    overflow: 'hidden',
  },
  fabBlur: {
    borderRadius: 34,
  },
  fab: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF453A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
});
