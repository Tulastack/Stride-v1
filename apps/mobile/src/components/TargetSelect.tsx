import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, LayoutChangeEvent, PanResponder,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Polyline, Rect } from 'react-native-svg';
import Slider from '@react-native-community/slider';
import { Button, Notice } from '../ui';
import { useTheme } from '../context/ThemeContext';
import { space, radius, type as typo } from '../theme';

type Pt = { x: number; y: number };

/**
 * Trace the runner to analyze. The brushed silhouette becomes a bounding box the
 * worker crop-tracks, so multi-person clips lock onto the intended athlete.
 * Skipping lets the model auto-pick the clearest person.
 */
export function TargetSelect({
  uri,
  videoWidth,
  videoHeight,
  onConfirm,
  onSkip,
  onCancel,
}: {
  uri: string;
  videoWidth?: number;
  videoHeight?: number;
  onConfirm: (target: { x0: number; y0: number; x1: number; y1: number; tMs: number }) => void;
  onSkip: () => void;
  onCancel?: () => void;
}) {
  const { colors } = useTheme();
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; p.pause(); });
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [seekMs, setSeekMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [sourceSize, setSourceSize] = useState({ width: videoWidth, height: videoHeight });
  const [previewError, setPreviewError] = useState(false);
  const [path, setPath] = useState<Pt[]>([]);

  useEffect(() => {
    const readSource = () => {
      setDurationMs(player.duration * 1000);
      const size = player.videoTrack?.size;
      if (size?.width && size?.height) setSourceSize(size);
    };
    readSource();
    const subscription = player.addListener?.('sourceLoad', readSource);
    const trackSubscription = player.addListener?.('videoTrackChange', readSource);
    const statusSubscription = player.addListener?.('statusChange', (event) => setPreviewError(event.status === 'error'));
    return () => { subscription?.remove(); trackSubscription?.remove(); statusSubscription?.remove(); };
  }, [player]);

  // Letterboxed content rect (contentFit="contain").
  const rect = useMemo(() => {
    const { w, h } = layout;
    if (!w || !h || !sourceSize.width || !sourceSize.height) return { ox: 0, oy: 0, cw: w || 1, ch: h || 1 };
    const va = sourceSize.width / sourceSize.height, wa = w / h;
    if (va > wa) { const ch = w / va; return { ox: 0, oy: (h - ch) / 2, cw: w, ch }; }
    const cw = h * va; return { ox: (w - cw) / 2, oy: 0, cw, ch: h };
  }, [layout, sourceSize]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        // Capture coords before setState, RN reuses synthetic events and
        // nulls nativeEvent by the time a functional updater runs.
        const x = e.nativeEvent.locationX;
        const y = e.nativeEvent.locationY;
        setPath([{ x, y }]);
      },
      onPanResponderMove: (e) => {
        const x = e.nativeEvent.locationX;
        const y = e.nativeEvent.locationY;
        setPath((p) => {
          const last = p[p.length - 1];
          // Throttle near-duplicate points for smoother brush performance.
          if (last && Math.hypot(x - last.x, y - last.y) < 2) return p;
          return [...p, { x, y }];
        });
      },
    }),
  ).current;

  const bbox = useMemo(() => {
    if (path.length < 3 || !sourceSize.width || !sourceSize.height) return null;
    const xs = path.map((point) => Math.max(rect.ox, Math.min(rect.ox + rect.cw, point.x)));
    const ys = path.map((point) => Math.max(rect.oy, Math.min(rect.oy + rect.ch, point.y)));
    const bounds = { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
    return bounds.maxx - bounds.minx >= 8 && bounds.maxy - bounds.miny >= 8 ? bounds : null;
  }, [path, rect, sourceSize]);

  const confirm = () => {
    if (!bbox) return;
    const c01 = (v: number) => Math.max(0, Math.min(1, v));
    onConfirm({
      x0: c01((bbox.minx - rect.ox) / rect.cw),
      y0: c01((bbox.miny - rect.oy) / rect.ch),
      x1: c01((bbox.maxx - rect.ox) / rect.cw),
      y1: c01((bbox.maxy - rect.oy) / rect.ch),
      tMs: seekMs,
    });
  };

  const pointsStr = path.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <View style={{ gap: 4 }}><Text accessibilityRole="header" style={[typo.h2, { color: colors.text }]}>Choose your athlete.</Text><Text style={[typo.caption, { color: colors.muted }]}>Scrub to a clear frame, then trace around the runner.</Text></View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Button label="Cancel" variant="quiet" onPress={onCancel} style={{ minHeight: 44, paddingVertical: 8 }} /><Button label="Clear trace" variant="quiet" disabled={!path.length} onPress={() => setPath([])} style={{ minHeight: 44, paddingVertical: 8 }} /></View>

      <View
        style={[styles.frame, { backgroundColor: colors.well, borderColor: colors.border }]}
        onLayout={(e: LayoutChangeEvent) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        {...pan.panHandlers}
      >
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} pointerEvents="none" />
        {layout.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {path.length > 1 && (
              <Polyline points={pointsStr} fill={colors.accent} fillOpacity={0.12} stroke={colors.accent} strokeWidth={3} strokeOpacity={0.9} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {bbox && (
              <Rect x={bbox.minx} y={bbox.miny} width={bbox.maxx - bbox.minx} height={bbox.maxy - bbox.miny} rx={6} stroke={colors.accent} strokeWidth={1.5} strokeDasharray="6 5" fill="none" />
            )}
          </Svg>
        )}
        {path.length === 0 && (
          <View style={styles.hintWrap} pointerEvents="none">
            <Text style={[styles.hint, { color: colors.muted, backgroundColor: colors.card }]}>Drag around the runner</Text>
          </View>
        )}
      </View>

      {previewError ? <Notice tone="error">The preview could not load. Choose another clip or use automatic athlete selection.</Notice> : null}
      <Slider accessibilityLabel="Preview frame" disabled={!durationMs} minimumValue={0} maximumValue={durationMs || 1} value={seekMs} minimumTrackTintColor={colors.goldInk} maximumTrackTintColor={colors.border} thumbTintColor={colors.goldInk} onSlidingComplete={(value: number) => { player.currentTime = value / 1000; setSeekMs(value); setPath([]); }} />
      <View style={styles.actions}><Button label="Auto-select athlete" testID="target-skip" variant="secondary" onPress={onSkip} style={{ flex: 1 }} /><Button label="Analyze" testID="target-confirm" disabled={!bbox} onPress={confirm} style={{ flex: 1 }} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.lg, gap: space.sm, maxWidth: 640, width: '100%', alignSelf: 'center' },
  frame: { flex: 1, minHeight: 100, width: '100%', borderRadius: radius.md, overflow: 'hidden' },
  hintWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space.lg },
  hint: { ...typo.caption, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, overflow: 'hidden' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
