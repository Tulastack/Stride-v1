import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Video } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import {
  GyroRecorder,
  buildCaptureManifest,
  uploadCaptureVideo,
  CAPTURE_PREFS,
} from '../../src/services/capture';
import { semantic, spacing, radius, borderWidth, typography } from '../../src/ui/theme';
import { TargetSelect } from '../../src/components/TargetSelect';

export default function UploadScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [sloMoPreferred, setSloMoPreferred] = useState(true);
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
      if (!mic.granted) throw new Error('Microphone permission is required to record video.');
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
        videoUri: uri,
        gyro: gyroSamples,
        durationMs,
        fps: sloMoPreferred ? CAPTURE_PREFS.preferredFps : 60,
        preferredFps: CAPTURE_PREFS.preferredFps,
        sloMoRequested: sloMoPreferred,
      });
      if (target) manifest.target = target;

      setProgressStep('RECONSTRUCTING 3D · QUEUED');
      const { analysisId } = await uploadCaptureVideo(uri, manifest, strideApi);

      setUploading(false);
      setProgressStep(null);
      router.push({ pathname: '/(tabs)/analysis', params: { analysisId } });
    } catch (err: unknown) {
      setUploading(false);
      setProgressStep(null);
      const message = err instanceof Error ? err.message : 'Error occurred.';
      Alert.alert('Analysis Failed', message);
    }
  };

  const handleSelectVideo = async () => {
    try {
      const pick = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 1,
      });
      if (pick.canceled || !pick.assets[0]) return;
      const asset = pick.assets[0];
      setPending({ uri: asset.uri, gyro: [], durationMs: asset.duration ?? 4000, width: asset.width, height: asset.height });
    } catch (err: unknown) {
      Alert.alert('Import failed', err instanceof Error ? err.message : 'Could not import video.');
    }
  };

  const handleStartRecord = async () => {
    try {
      await ensurePermissions();
      setShowCamera(true);
    } catch (err: unknown) {
      Alert.alert('Permissions', err instanceof Error ? err.message : 'Camera unavailable.');
    }
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
      gyroRef.current.stop();
      setRecording(false);
      setShowCamera(false);
      Alert.alert('Recording failed', err instanceof Error ? err.message : 'Could not record.');
    }
  };

  const handleStopRecord = () => {
    cameraRef.current?.stopRecording();
  };

  if (showCamera) {
    return (
      <SafeAreaView style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} mode="video" facing="back" videoQuality="1080p">
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraHint}>
              Handheld is fine — any angle. {sloMoPreferred ? CAPTURE_PREFS.sloMoLabel : '60fps mode'}.
            </Text>
            <TouchableOpacity
              style={[styles.recordBtn, recording && styles.recordBtnActive]}
              onPress={recording ? handleStopRecord : handleRecord}
              accessibilityLabel="capture-record"
            >
              <View style={[styles.recordInner, recording && styles.recordInnerActive]} />
            </TouchableOpacity>
          </View>
        </CameraView>
      </SafeAreaView>
    );
  }

  if (pending) {
    return (
      <SafeAreaView style={styles.container}>
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Capture</Text>
          <Text style={styles.subtitle}>Film your stride — any angle, handheld OK</Text>
        </View>

        <View style={styles.prefRow}>
          <Text style={styles.prefLabel}>{CAPTURE_PREFS.sloMoLabel}</Text>
          <Switch
            value={sloMoPreferred}
            onValueChange={setSloMoPreferred}
            accessibilityLabel="slo-mo-preference"
          />
        </View>
        <Text style={styles.prefHint}>Gyro + camera intrinsics are recorded automatically during capture.</Text>

        {uploading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={semantic.action.primary} />
            <Text style={styles.loadingText}>{progressStep}</Text>
          </View>
        ) : (
          <View style={styles.actionContainer}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleStartRecord} disabled={recording}>
              <Camera color="#FFFFFF" size={28} />
              <Text style={styles.buttonText}>Record sprint</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={handleSelectVideo}>
              <Video color={semantic.text.primary} size={22} />
              <Text style={styles.secondaryButtonText}>Import video</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: semantic.surface.base },
  content: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  header: { marginBottom: spacing.xl },
  title: { ...(typography.display as object), color: semantic.text.primary },
  subtitle: { ...(typography.body as object), color: semantic.text.muted, marginTop: spacing.sm },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: semantic.border,
  },
  prefLabel: { ...(typography.bodyStrong as object), color: semantic.text.primary, flex: 1, paddingRight: spacing.md },
  prefHint: { ...(typography.caption as object), color: semantic.text.muted },
  actionContainer: { gap: spacing.lg },
  primaryButton: {
    backgroundColor: semantic.action.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    borderRadius: radius.sm,
    gap: spacing.md,
  },
  buttonText: { ...(typography.bodyStrong as object), color: '#FFFFFF', letterSpacing: 0.5 },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  secondaryButtonText: { ...(typography.bodyStrong as object), color: semantic.text.primary },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    borderRadius: radius.sm,
  },
  loadingText: { ...(typography.caption as object), color: semantic.text.muted, letterSpacing: 1, marginTop: spacing.lg },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: spacing.xxxl, gap: spacing.lg },
  cameraHint: {
    ...(typography.caption as object),
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    textAlign: 'center',
    marginHorizontal: spacing.lg,
  },
  recordBtn: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { borderColor: semantic.status.flaw },
  recordInner: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: semantic.status.flaw },
  recordInnerActive: { width: 20, height: 20, borderRadius: radius.sm },
});
