import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Camera, Image as ImageIcon, ArrowUpRight } from 'lucide-react-native';
import { strideApi } from '../../src/services/api';
import { GyroRecorder, AccelRecorder, buildCaptureManifest, uploadCaptureVideo, CAPTURE_PREFS, type GyroSample, type AccelSample, type CaptureManifest } from '../../src/services/capture';
import { useTheme } from '../../src/context/ThemeContext';
import { useStrideStore } from '../../src/store/useStrideStore';
import { TargetSelect } from '../../src/components/TargetSelect';
import { CaptureCamera } from '../../src/components/CaptureCamera';
import { useTabChrome } from '../../src/context/TabChromeContext';
import { Screen, ScreenHeader, TrackScene, Button, Notice, Sheet, StrideLogo } from '../../src/ui';
import { space, radius, type as typo } from '../../src/theme';

type Clip = { uri: string; gyro: GyroSample[]; accel: AccelSample[]; durationMs: number; width?: number; height?: number };
type Target = CaptureManifest['target'];

export default function CaptureScreen() {
  const { colors } = useTheme();
  const { setImmersive } = useTabChrome();
  const user = useStrideStore((state) => state.user);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [preferHighRate, setPreferHighRate] = useState(true);
  const [clip, setClip] = useState<Clip | null>(null);
  const [selected, setSelected] = useState(false);
  const [target, setTarget] = useState<Target>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const gyroRef = useRef(new GyroRecorder());
  const accelRef = useRef(new AccelRecorder());
  const discardRef = useRef(false);
  const mounted = useRef(true);
  const recordLock = useRef(false);
  const recordingStartedAt = useRef<number | null>(null);

  useFocusEffect(useCallback(() => {
    setImmersive(showCamera);
    return () => {
      setImmersive(false);
      if (showCamera) {
        discardRef.current = true;
        cameraRef.current?.stopRecording();
        setShowCamera(false);
      }
    };
  }, [showCamera, setImmersive]));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; discardRef.current = true; cameraRef.current?.stopRecording(); gyroRef.current.stop(); accelRef.current.stop(); };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(recordingStartedAt.current === null ? 0 : Math.min(12, (Date.now() - recordingStartedAt.current) / 1000)), 100);
    return () => clearInterval(timer);
  }, [recording]);

  const openCamera = useCallback(async () => {
    setError('');
    try {
      if (!cameraPermission?.granted && !(await requestCameraPermission()).granted) throw new Error('Camera access is needed to record. You can still import a video.');
      if (!micPermission?.granted && !(await requestMicPermission()).granted) throw new Error('Microphone access is needed for video capture. You can still import a video.');
      setCameraReady(false); setShowCamera(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open camera.'); }
  }, [cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  const importVideo = async () => {
    setError('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (picked.canceled || !picked.assets[0]) return;
      const video = picked.assets[0];
      setSelected(false); setTarget(undefined);
      setClip({ uri: video.uri, gyro: [], accel: [], durationMs: video.duration ?? 4000, width: video.width, height: video.height });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not import your video.'); }
  };

  const record = async () => {
    if (!cameraRef.current || !cameraReady || recordLock.current) return;
    recordLock.current = true; discardRef.current = false; recordingStartedAt.current = null; setElapsed(0); setRecording(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await Promise.all([gyroRef.current.start(), accelRef.current.start()]);
      if (!mounted.current || discardRef.current || !cameraRef.current) return;
      const start = Date.now();
      recordingStartedAt.current = start;
      const video = await cameraRef.current.recordAsync({ maxDuration: 12 });
      const durationMs = Date.now() - start;
      const gyro = gyroRef.current.stop(), accel = accelRef.current.stop();
      if (mounted.current && !discardRef.current && video?.uri) {
        setClip({ uri: video.uri, gyro, accel, durationMs }); setSelected(false); setTarget(undefined);
      }
    } catch (failure) {
      if (mounted.current && !discardRef.current) setError(failure instanceof Error ? failure.message : 'Recording failed. Please try again.');
    } finally {
      gyroRef.current.stop(); accelRef.current.stop(); recordLock.current = false; recordingStartedAt.current = null;
      if (mounted.current) { setRecording(false); setShowCamera(false); }
    }
  };

  const upload = async (video: Clip, chosenTarget?: Target) => {
    if (uploading) return;
    setUploading(true); setError(''); setSelected(true); setTarget(chosenTarget);
    try {
      const manifest = buildCaptureManifest({ videoUri: video.uri, gyro: video.gyro, accelerometer: video.accel, durationMs: video.durationMs, fps: 30, preferredFps: CAPTURE_PREFS.preferredFps, sloMoRequested: preferHighRate, widthPx: video.width, heightPx: video.height });
      if (chosenTarget) manifest.target = chosenTarget;
      const { analysisId } = await uploadCaptureVideo(video.uri, manifest, strideApi, { apiBaseUrl: useStrideStore.getState().apiBaseUrl, token: useStrideStore.getState().token });
      if (!mounted.current) return;
      setClip(null); router.push({ pathname: '/(tabs)/analysis', params: { analysisId } });
    } catch (failure: any) {
      if (!mounted.current) return;
      if (failure?.code === 'CONSENT_REQUIRED') router.push('/(onboarding)/consent');
      setError(failure?.message ?? 'Upload failed. Your clip is kept here so you can retry.');
    } finally { if (mounted.current) setUploading(false); }
  };

  const cancelCamera = () => {
    discardRef.current = true;
    if (recording) cameraRef.current?.stopRecording();
    setShowCamera(false);
  };

  if (showCamera) return <CaptureCamera cameraRef={cameraRef} ready={cameraReady} recording={recording} elapsed={elapsed} onReady={() => setCameraReady(true)} onRecord={record} onStop={() => cameraRef.current?.stopRecording()} onCancel={cancelCamera} onImport={() => { setShowCamera(false); importVideo(); }} onError={(message) => { setError(message); setShowCamera(false); }} />;
  if (clip && !selected) return <Screen scroll={false}><TargetSelect uri={clip.uri} videoWidth={clip.width} videoHeight={clip.height} onConfirm={(chosen) => upload(clip, chosen)} onSkip={() => upload(clip)} onCancel={() => setClip(null)} /></Screen>;
  if (clip && selected) return <Screen>
    <ScreenHeader logo title={uploading ? 'Sending your sprint.' : 'Your clip is safe here.'} />
    <View style={[styles.stage, { backgroundColor: colors.well }]}><TrackScene /><Text accessibilityLiveRegion="polite" style={[typo.h2, { color: colors.wellText, padding: 24 }]}>{uploading ? 'Uploading video' : 'Ready to retry'}</Text></View>
    {uploading ? <View style={{ gap: 16 }}><ActivityIndicator color={colors.goldInk} /><Text style={[typo.body, { color: colors.muted }]}>The analysis starts after the upload completes. Keep Stride open.</Text></View> : <><Notice tone="error">{error}</Notice><Button label="Retry upload" onPress={() => upload(clip, target)} /><Button label="Choose another clip" variant="secondary" onPress={() => { setClip(null); setError(''); }} /></>}
  </Screen>;

  return <Screen>
    <View style={styles.brand}><StrideLogo height={32} />{user?.display_name ? <Text style={[typo.caption, { color: colors.muted }]}>{user.display_name.split(' ')[0]}</Text> : null}</View>
    <View><Text style={[typo.display, { color: colors.text }]}>Meet your stride.</Text><Text style={[typo.body, { color: colors.muted, marginTop: 8 }]}>A few seconds of movement. A clearer way forward.</Text></View>
    <View style={[styles.stage, { backgroundColor: colors.well }]}><View style={styles.stageHeading}><StrideLogo markOnly height={28} color={colors.accent} /></View><TrackScene /><View style={styles.stageFooter}><View style={{ flex: 1, gap: 6 }}><Text style={[typo.h2, { color: colors.wellText }]}>Your movement,{'\n'}in focus.</Text><Text style={[typo.caption, { color: colors.wellMuted }]}>Side-on · Full body · Up to 12 s</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Record sprint" onPress={openCamera} style={[styles.shutter, { borderColor: colors.wellBorder }]}><View style={[styles.shutterFill, { backgroundColor: colors.accent }]}><Camera color={colors.accentText} size={24} strokeWidth={1.6} /></View></Pressable></View></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Import from library" onPress={importVideo} style={[styles.importRow, { borderBottomColor: colors.border }]}><ImageIcon size={20} color={colors.goldInk} /><View style={{ flex: 1 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>Bring your own footage</Text><Text style={[typo.caption, { color: colors.muted }]}>Import a sprint from your library</Text></View><ArrowUpRight size={18} color={colors.muted} /></Pressable>
    {error ? <Notice tone="error">{error}</Notice> : null}
    <View style={styles.importRow}><View style={{ flex: 1 }}><Text style={[typo.bodyMedium, { color: colors.text }]}>Prefer high-rate footage</Text><Text style={[typo.caption, { color: colors.muted }]}>Import 120 fps for clearer foot contacts. In-app recording is standard ~30 fps.</Text></View><Switch accessibilityLabel="Prefer high-rate footage" value={preferHighRate} onValueChange={setPreferHighRate} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.card} /></View>
    <Button label="How to film a useful sprint" variant="quiet" onPress={() => setShowGuide(true)} />
    <Sheet visible={showGuide} title="A clear view changes everything." onClose={() => setShowGuide(false)}><Text style={[typo.body, { color: colors.muted }]}>Place your phone 10–20 m from your running line. Film from the side, keep your full body and feet visible, and use good lighting. Keep the phone steady. Capture a short running segment, not just a standing pose.</Text><Notice>For high-frame-rate footage, use your phone's camera and import the clip. The in-app camera does not guarantee 120 fps.</Notice><Button label="Open camera" onPress={() => { setShowGuide(false); openCamera(); }} /></Sheet>
  </Screen>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stage: { borderRadius: radius.lg, overflow: 'hidden' },
  stageHeading: { padding: space.xl, alignItems: 'flex-start' },
  stageFooter: { padding: space.xl, paddingTop: 0, flexDirection: 'row', alignItems: 'center', gap: 16 },
  shutter: { width: 76, height: 76, borderWidth: 1, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  shutterFill: { width: 56, height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  importRow: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5 },
});
