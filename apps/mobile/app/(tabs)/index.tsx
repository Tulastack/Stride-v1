import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Zap, ChevronRight } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { GyroRecorder, AccelRecorder, buildCaptureManifest, uploadCaptureVideo, CAPTURE_PREFS } from '../../src/services/capture';
import { useTheme } from '../../src/context/ThemeContext';
import { useStrideStore } from '../../src/store/useStrideStore';
import { TargetSelect } from '../../src/components/TargetSelect';
import { space, radius, type as typo, iconStroke } from '../../src/theme';

export default function UploadScreen() {
  const { colors } = useTheme();
  const user = useStrideStore((s) => s.user);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [slowMo, setSlowMo] = useState(true);
  const [pending, setPending] = useState<{ uri: string; gyro: any; accel?: any; durationMs: number; width?: number; height?: number } | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const gyroRef = useRef(new GyroRecorder());
  const accelRef = useRef(new AccelRecorder());

  const firstName = user?.display_name ? user.display_name.split(' ')[0] : null;

  const ensurePermissions = useCallback(async () => {
    if (!cameraPermission?.granted) { const c = await requestCameraPermission(); if (!c.granted) throw new Error('Camera permission required.'); }
    if (!micPermission?.granted) { const m = await requestMicPermission(); if (!m.granted) throw new Error('Microphone permission required.'); }
  }, [cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  const processVideo = async (uri: string, gyroSamples: any, durationMs: number, target?: any, accelSamples?: any) => {
    setUploading(true); setProgressStep('UPLOADING');
    try {
      const manifest = buildCaptureManifest({
        videoUri: uri,
        gyro: gyroSamples,
        accelerometer: accelSamples,
        durationMs,
        // TODO: high-fps capture needs react-native-vision-camera or native
        // camera config — CameraView records at the platform default (~30fps).
        fps: 30,
        preferredFps: CAPTURE_PREFS.preferredFps,
        sloMoRequested: slowMo,
      });
      if (target) manifest.target = target;
      setProgressStep('ANALYZING SPRINT');
      const { analysisId } = await uploadCaptureVideo(uri, manifest, strideApi, {
        apiBaseUrl: useStrideStore.getState().apiBaseUrl,
        token: useStrideStore.getState().token,
      });
      setUploading(false); setProgressStep(null);
      router.push({ pathname: '/(tabs)/analysis', params: { analysisId } });
    } catch (err: any) {
      setUploading(false); setProgressStep(null);
      if (err?.code === 'CONSENT_REQUIRED') { router.push('/(onboarding)/consent'); return; }
      Alert.alert('Failed', err.message || 'Error.');
    }
  };

  const handleSelectVideo = async () => {
    try {
      const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (pick.canceled || !pick.assets[0]) return;
      const a = pick.assets[0];
      setPending({ uri: a.uri, gyro: [], accel: [], durationMs: a.duration ?? 4000, width: a.width, height: a.height });
    } catch (err: any) { Alert.alert('Import failed', err.message); }
  };

  const handleStartRecord = async () => {
    try { await ensurePermissions(); setShowCamera(true); }
    catch (err: any) { Alert.alert('Permissions', err.message); }
  };

  const handleRecord = async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    await Promise.all([gyroRef.current.start(), accelRef.current.start()]);
    try {
      // Real duration from wall-clock timestamps — recordAsync resolves on stop.
      const startedAt = Date.now();
      const video = await cameraRef.current.recordAsync({ maxDuration: 12 });
      const durationMs = Date.now() - startedAt;
      const gyro = gyroRef.current.stop();
      const accel = accelRef.current.stop();
      setRecording(false); setShowCamera(false);
      if (video?.uri) setPending({ uri: video.uri, gyro, accel, durationMs });
    } catch {
      gyroRef.current.stop();
      accelRef.current.stop();
      setRecording(false); setShowCamera(false);
    }
  };

  if (showCamera) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} mode="video" facing="back" videoQuality="1080p">
          <View style={styles.cameraOverlay}>
            <Pressable style={styles.closeBtn} onPress={() => { setRecording(false); setShowCamera(false); }}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
            <Text style={styles.cameraHint}>{slowMo ? CAPTURE_PREFS.sloMoLabel : 'Standard capture'} · Handheld OK</Text>
            <Pressable style={[styles.camBtn, recording && { borderColor: colors.error }]} onPress={recording ? () => cameraRef.current?.stopRecording() : handleRecord}>
              <View style={[styles.camInner, recording && { width: 20, height: 20, borderRadius: 4 }]} />
            </Pressable>
          </View>
        </CameraView>
      </SafeAreaView>
    );
  }

  if (pending) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <TargetSelect uri={pending.uri} videoWidth={pending.width} videoHeight={pending.height}
          onConfirm={(t) => { const p = pending; setPending(null); processVideo(p.uri, p.gyro, p.durationMs, t, p.accel); }}
          onSkip={() => { const p = pending; setPending(null); processVideo(p.uri, p.gyro, p.durationMs, undefined, p.accel); }} />
      </SafeAreaView>
    );
  }

  if (uploading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.uploadWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.uploadStep, { color: colors.accent }]}>{progressStep}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.wordmark, { color: colors.accent }]}>STRIDE</Text>
            <Text style={[styles.tagline, { color: colors.muted }]}>{firstName ? `Welcome back, ${firstName}` : 'AI sprint analysis'}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <View style={[styles.outerRing, { backgroundColor: colors.cardAlt }]}>
            <Pressable style={({ pressed }) => [styles.recordBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.85 }]} onPress={handleStartRecord}>
              <Camera size={30} color={colors.accentText} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={[styles.recordLabel, { color: colors.muted }]}>TAP TO RECORD</Text>
          <Pressable hitSlop={8} onPress={handleSelectVideo}>
            <Text style={[styles.importLink, { color: colors.accent }]}>or import video from library</Text>
          </Pressable>
        </View>

        <View style={[styles.settingRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>High frame rate when available</Text>
          <Switch value={slowMo} onValueChange={setSlowMo} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.card} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl, justifyContent: 'space-between' },
  headerRow: { marginBottom: space.md },
  wordmark: { fontSize: 42, fontWeight: '900', letterSpacing: 2 },
  tagline: { fontSize: 14, marginTop: 4, letterSpacing: 0.5 },
  hero: { alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.xxl },
  outerRing: { width: 110, height: 110, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  recordBtn: { width: 80, height: 80, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  recordLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 1.1 },
  importLink: { fontSize: 15, fontWeight: '500', textDecorationLine: 'underline' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: space.lg },
  settingLabel: { fontSize: 15, fontWeight: '500' },
  uploadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  uploadStep: { fontSize: 12, fontWeight: '600', letterSpacing: 1.1 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: space.xxxl, gap: space.lg },
  closeBtn: { position: 'absolute', top: space.xl, right: space.xl, width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cameraHint: { fontSize: 12, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', padding: space.sm, borderRadius: radius.sm },
  camBtn: { width: 64, height: 64, borderRadius: radius.pill, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  camInner: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: '#C1432B' },
});
