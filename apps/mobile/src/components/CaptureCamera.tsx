import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Image as ImageIcon, ScanLine, X } from 'lucide-react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { iconStroke, radius, type as typo } from '../theme';
import { StrideLogo } from '../ui/StrideLogo';

interface CaptureCameraProps {
  cameraRef: React.RefObject<CameraView | null>;
  ready: boolean; recording: boolean; elapsed: number;
  onReady: () => void; onRecord: () => void; onStop: () => void;
  onCancel: () => void; onImport: () => void; onError: (message: string) => void;
}

export function CaptureCamera({ cameraRef, ready, recording, elapsed, onReady, onRecord, onStop, onCancel, onImport, onError }: CaptureCameraProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [guides, setGuides] = useState(true);
  const progress = Math.max(0, Math.min(1, elapsed / 12));
  const circumference = 2 * Math.PI * 41;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onCancel(); return true; });
    return () => subscription.remove();
  }, [onCancel]);

  return <View testID="capture-camera-stage" style={[styles.stage, { backgroundColor: colors.well }]}>
    <StatusBar style="light" />
    <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} mode="video" facing="back" videoQuality="1080p" onCameraReady={onReady} onMountError={(event) => onError(event.message)} />
    <LinearGradient pointerEvents="none" colors={[colors.cameraShade, colors.transparent]} style={styles.topShade} />
    <LinearGradient pointerEvents="none" colors={[colors.transparent, colors.cameraShade, colors.cameraShade]} locations={[0, 0.4, 1]} style={[styles.bottomShade, { height: height < 700 ? 300 : 340 }]} />
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={onCancel} style={[styles.roundButton, { backgroundColor: colors.overlay }]}><X size={21} color={colors.wellText} /></Pressable>
      <StrideLogo height={24} color={colors.wellText} />
      <View accessibilityLabel={recording ? `${elapsed.toFixed(1)} of 12 seconds recorded` : 'Up to 12 seconds'} style={[styles.timer, { backgroundColor: colors.overlay }]}>
        {recording ? <View style={[styles.liveDot, { backgroundColor: colors.accent }]} /> : null}
        <Text style={[typo.caption, { color: colors.wellText, fontVariant: ['tabular-nums'] }]}>{recording ? `${elapsed.toFixed(1)} / 12 s` : '12 s max'}</Text>
      </View>
    </View>
    {guides ? <View testID="camera-framing-guide" pointerEvents="none" accessible accessibilityLabel="Framing guide, not body tracking. Keep your full body in view." style={[styles.framing, { top: insets.top + 96, bottom: Math.max(insets.bottom, 16) + (height < 700 ? 235 : 280) }]}>
      <Svg width="100%" height="100%" viewBox="0 0 300 360" preserveAspectRatio="none">
        <Path d="M 44 8 L 30 8 Q 8 8 8 30 L 8 104 M 8 256 L 8 330 Q 8 352 30 352 L 44 352 M 256 8 L 270 8 Q 292 8 292 30 L 292 104 M 292 256 L 292 330 Q 292 352 270 352 L 256 352" fill="none" stroke={colors.accent} strokeOpacity={0.7} strokeWidth={1.5} strokeLinecap="round" />
      </Svg>
    </View> : null}
    <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text accessibilityRole="header" style={[typo.h2, { color: colors.wellText }]}>{recording ? 'Make it your stride.' : 'Ready when you are.'}</Text>
        <Text accessibilityLiveRegion="polite" style={[typo.caption, { color: colors.wellText, textAlign: 'center' }]}>{recording ? 'Keep moving. Tap to finish your clip.' : !ready ? 'Getting your camera ready…' : guides ? 'Side-on. Whole body in view.' : 'Tap the gold button, then run.'}</Text>
        {!recording ? <Text style={[typo.caption, { color: colors.wellMuted }]}>Phone steady · 10–20 m from your lane</Text> : null}
      </View>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Import from library" accessibilityState={{ disabled: recording }} disabled={recording} onPress={onImport} style={[styles.sideControl, { opacity: recording ? 0.35 : 1 }]}><ImageIcon size={22} strokeWidth={iconStroke} color={colors.wellText} /><Text style={[typo.caption, { color: colors.wellText }]}>Library</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : 'Start recording'} accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={recording ? onStop : onRecord} style={[styles.shutter, { opacity: ready ? 1 : 0.45 }]}>
          <Svg pointerEvents="none" width={90} height={90} style={StyleSheet.absoluteFill}>
            <Circle cx={45} cy={45} r={41} fill="none" stroke={colors.wellText} strokeOpacity={0.35} strokeWidth={2} />
            {recording ? <Circle testID="recording-progress-ring" cx={45} cy={45} r={41} fill="none" stroke={colors.accent} strokeWidth={3} strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} rotation={-90} origin="45, 45" strokeLinecap="round" /> : null}
          </Svg>
          <View style={[styles.shutterFill, { backgroundColor: colors.accent }]}>{recording ? <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: colors.accentText }} /> : <View style={{ width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.accentText }} />}</View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={guides ? 'Hide framing guide' : 'Show framing guide'} accessibilityState={{ selected: guides }} onPress={() => setGuides(!guides)} style={styles.sideControl}><ScanLine size={22} strokeWidth={iconStroke} color={guides ? colors.accent : colors.wellText} /><Text style={[typo.caption, { color: colors.wellText }]}>Guide</Text></Pressable>
      </View>
      <Text style={[typo.tiny, { color: colors.wellMuted, textAlign: 'center', letterSpacing: 0 }]}>{recording ? 'Your clip ends automatically at 12 seconds.' : 'One short sprint. A clearer next step.'}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 190 },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  top: { position: 'absolute', top: 0, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  roundButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  timer: { minHeight: 44, paddingHorizontal: 12, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: radius.pill },
  framing: { position: 'absolute', left: 30, right: 30 },
  bottom: { position: 'absolute', bottom: 0, left: 20, right: 20, gap: 18 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', gap: 12 },
  sideControl: { minWidth: 64, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 6 },
  shutter: { width: 90, height: 90, alignItems: 'center', justifyContent: 'center' },
  shutterFill: { width: 70, height: 70, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
