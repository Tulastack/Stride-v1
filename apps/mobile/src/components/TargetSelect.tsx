import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TouchableOpacity, LayoutChangeEvent, GestureResponderEvent,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Circle } from 'react-native-svg';
import { semantic, spacing, radius, typography } from '../ui/theme';

const ACCENT = '#FF453A';

/**
 * Lets the user circle the runner to analyze on the first frame, so multi-person
 * clips lock onto the intended athlete. Returns normalized (x,y) in the FULL
 * video frame. If they skip, the pipeline auto-picks the clearest person.
 */
export function TargetSelect({
  uri,
  videoWidth,
  videoHeight,
  onConfirm,
  onSkip,
}: {
  uri: string;
  videoWidth?: number;
  videoHeight?: number;
  onConfirm: (target: { xNorm: number; yNorm: number; tMs: number }) => void;
  onSkip: () => void;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; p.pause(); });
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null); // pixels within box

  // Letterboxed content rect (contentFit="contain").
  const rect = useMemo(() => {
    const { w, h } = layout;
    if (!w || !h) return { ox: 0, oy: 0, cw: w, ch: h };
    if (!videoWidth || !videoHeight) return { ox: 0, oy: 0, cw: w, ch: h };
    const va = videoWidth / videoHeight;
    const wa = w / h;
    if (va > wa) { const ch = w / va; return { ox: 0, oy: (h - ch) / 2, cw: w, ch }; }
    const cw = h * va; return { ox: (w - cw) / 2, oy: 0, cw, ch: h };
  }, [layout, videoWidth, videoHeight]);

  const onTap = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    setMark({ x: locationX, y: locationY });
  };

  const confirm = () => {
    if (!mark) return;
    const xNorm = Math.max(0, Math.min(1, (mark.x - rect.ox) / (rect.cw || 1)));
    const yNorm = Math.max(0, Math.min(1, (mark.y - rect.oy) / (rect.ch || 1)));
    onConfirm({ xNorm, yNorm, tMs: 0 });
  };

  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>TAP THE RUNNER TO ANALYZE</Text>
      <Text style={styles.sub}>If there are several people, circle the one you want. We'll track them through the clip.</Text>

      <Pressable style={styles.frame} onPress={onTap} onLayout={(e: LayoutChangeEvent) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        {mark && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Circle cx={mark.x} cy={mark.y} r={34} stroke={ACCENT} strokeWidth={3} fill={ACCENT} fillOpacity={0.15} />
            <Circle cx={mark.x} cy={mark.y} r={4} fill={ACCENT} />
          </Svg>
        )}
      </Pressable>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.skip} onPress={onSkip} accessibilityLabel="target-skip">
          <Text style={styles.skipText}>Analyze automatically</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.confirm, !mark && styles.confirmDisabled]} onPress={confirm} disabled={!mark} accessibilityLabel="target-confirm">
          <Text style={styles.confirmText}>Analyze this runner</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050508', padding: spacing.lg, gap: spacing.md, justifyContent: 'center', zIndex: 10 },
  title: { ...(typography.bodyStrong as object), color: semantic.text.primary, letterSpacing: 1, textAlign: 'center' },
  sub: { ...(typography.caption as object), color: semantic.text.muted, textAlign: 'center' },
  frame: { width: '100%', aspectRatio: 9 / 16, maxHeight: 520, alignSelf: 'center', backgroundColor: '#000', borderRadius: radius.md, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  skip: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: semantic.surface.raised },
  skipText: { ...(typography.caption as object), color: semantic.text.secondary },
  confirm: { flex: 2, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: ACCENT },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { ...(typography.bodyStrong as object), color: '#FFFFFF' },
});
