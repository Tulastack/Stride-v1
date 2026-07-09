import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import {
  GyroRecorder,
  buildCaptureManifest,
  uploadCaptureVideo,
  CAPTURE_PREFS,
} from '../../src/services/capture';
import { TargetSelect } from '../../src/components/TargetSelect';

// Theme (from Magic Patterns)
const colors = { bg: '#0E0F12', card: '#16181D', border: '#353A44', text: '#ECE7DC', muted: '#8A8E97', accent: '#CDFF4F', accentText: '#0E0F12', error: '#FF5237' };
const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
const radius = { sm: 8, md: 12, pill: 999 };

export default function UploadScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [slowMo, setSlowMo] = useState(true);
  const [pending, setPending] = useState<{
    uri: string;
    gyro: ReturnType<GyroRecorder['stop']>;
    durationMs: number;
    width?: number;
    height?: number;
  } | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const gyroRef = useRef(new GyroRecorder());

  const ensurePermissions = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const cam = await requestCameraPermission();
      if (!cam.granted) throw new Error('Camera permission is required to record.');
    }
    if (!micPermission?.granted) {
      const mic = await requestMicPermission();
      if (!mic.granted) throw new Error('Microphone permission is required.');
    }
  }, [cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  const processVideo = async (
    uri: string,
    gyroSamples: ReturnType<GyroRecorder['stop']>,
    durationMs: number,
    target?: { xNorm: number; yNorm: number; tMs: number },
  ) => {
    setUploading(true);
    setProgressStep('UPLOADING · GYRO ATTACHED');
    try {
      const manifest = buildCaptureManifest({
        videoUri: uri, gyro: gyroSamples, durationMs,
        fps: slowMo ? CAPTURE_PREFS.preferredFps : 60,
        preferredFps: CAPTURE_PREFS.preferredFps,
        sloMoRequested: slowMo,
      });
      if (target) manifest.target = target;
      setProgressStep('ANALYZING SPRINT');
      const { analysisId } = await uploadCaptureVideo(uri, manifest, strideApi);
      setUploading(false);
      setProgressStep(null);
      router.push({ pathname: '/(tabs)/analysis', params: { analysisId } });
    } catch (err: unknown) {
      setUploading(false);
      setProgressStep(null);
      Alert.alert('Analysis Failed', err instanceof Error ? err.message : 'Error occurred.');
    }
  };

  const handleSelectVideo = async () => {
    try {
      const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (pick.canceled || !pick.assets[0]) return;
      const asset = pick.assets[0];
      setPending({ uri: asset.uri, gyro: [], durationMs: asset.duration ?? 4000, width: asset.width, height: asset.height });
    } catch (err: unknown) {
      Alert.alert('Import failed', err instanceof Error ? err.message : 'Could not import video.');
    }
  };

  const handleStartRecord = async () => {
    try { await ensurePermissions(); setShowCamera(true); }
    catch (err: unknown) { Alert.alert('Permissions', err instanceof Error ? err.message : 'Camera unavailable.'); }
  };

  const handleRecord = async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    await gyroRef.current.start();
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 12 });
      const gyro = gyroRef.current.stop();
      setRecording(false);
      setShowCamera(false);
      if (video?.uri) setPending({ uri: video.uri, gyro, durationMs: 12000 });
    } catch (err: unknown) {
      gyroRef.current.stop(); setRecording(false); setShowCamera(false);
      Alert.alert('Recording failed', err instanceof Error ? err.message : 'Could not record.');
    }
  };

  const handleStopRecord = () => { cameraRef.current?.stopRecording(); };

  // Camera view
  if (showCamera) {
    return (
      <SafeAreaView style={styles.safe}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} mode="video" facing="back" videoQuality="1080p">
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraHint}>
              {slowMo ? CAPTURE_PREFS.sloMoLabel : '60fps'} · Handheld OK
            </Text>
            <Pressable
              style={[styles.camRecordBtn, recording && { borderColor: colors.error }]}
              onPress={recording ? handleStopRecord : handleRecord}
            >
              <View style={[styles.camRecordInner, recording && { width: 20, height: 20, borderRadius: 4 }]} />
            </Pressable>
          </View>
        </CameraView>
      </SafeAreaView>
    );
  }

  // Target selection
  if (pending) {
    return (
      <SafeAreaView style={styles.safe}>
        <TargetSelect
          uri={pending.uri}
          videoWidth={pending.width}
          videoHeight={pending.height}
          onConfirm={(target) => { const p = pending; setPending(null); void processVideo(p.uri, p.gyro, p.durationMs, target); }}
          onSkip={() => { const p = pending; setPending(null); void processVideo(p.uri, p.gyro, p.durationMs); }}
        />
      </SafeAreaView>
    );
  }

  // Uploading state
  if (uploading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.uploadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.uploadingStep}>{progressStep}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Idle state (Magic Patterns design) ─────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.brandBlock}>
          <Text style={styles.wordmark}>STRIDE</Text>
          <Text style={styles.tagline}>AI Sprint Analysis</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.outerRing}>
            <Pressable
              style={({ pressed }) => [styles.recordBtn, pressed && { opacity: 0.85 }]}
              onPress={handleStartRecord}
            >
              <Camera size={30} color={colors.accentText} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={styles.recordLabel}>TAP TO RECORD</Text>
          <Pressable hitSlop={8} onPress={handleSelectVideo}>
            <Text style={styles.importLink}>or import video from library</Text>
          </Pressable>
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>240fps Slow Motion</Text>
          <Switch
            value={slowMo}
            onValueChange={setSlowMo}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.bg}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: space.xl, justifyContent: 'space-between' },
  brandBlock: { paddingTop: space.xl },
  wordmark: { fontSize: 32, fontWeight: '800', color: colors.accent, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: colors.muted, marginTop: 2 },
  hero: { alignItems: 'center', justifyContent: 'center', gap: space.lg },
  outerRing: {
    width: 110, height: 110, borderRadius: radius.pill,
    backgroundColor: 'rgba(205, 255, 79, 0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  recordBtn: {
    width: 80, height: 80, borderRadius: radius.pill,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  recordLabel: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 1.2 },
  importLink: { fontSize: 15, fontWeight: '500', color: colors.accent, textDecorationLine: 'underline' },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingVertical: space.lg, marginBottom: space.md,
  },
  settingLabel: { fontSize: 15, fontWeight: '500', color: colors.text },
  uploadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  uploadingStep: { fontSize: 12, fontWeight: '600', color: colors.accent, letterSpacing: 1.2 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: space.xxxl, gap: space.lg },
  cameraHint: { fontSize: 12, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', padding: space.sm, borderRadius: radius.sm },
  camRecordBtn: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  camRecordInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.error },
});
