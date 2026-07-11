import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, LayoutChangeEvent, PanResponder,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Polyline, Rect } from 'react-native-svg';
import { Check } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { space, radius, type as typo, iconStroke } from '../theme';

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
}: {
  uri: string;
  videoWidth?: number;
  videoHeight?: number;
  onConfirm: (target: { x0: number; y0: number; x1: number; y1: number; tMs: number }) => void;
  onSkip: () => void;
}) {
  const { colors } = useTheme();
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; p.pause(); });
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [path, setPath] = useState<Pt[]>([]);

  // Letterboxed content rect (contentFit="contain").
  const rect = useMemo(() => {
    const { w, h } = layout;
    if (!w || !h || !videoWidth || !videoHeight) return { ox: 0, oy: 0, cw: w || 1, ch: h || 1 };
    const va = videoWidth / videoHeight, wa = w / h;
    if (va > wa) { const ch = w / va; return { ox: 0, oy: (h - ch) / 2, cw: w, ch }; }
    const cw = h * va; return { ox: (w - cw) / 2, oy: 0, cw, ch: h };
  }, [layout, videoWidth, videoHeight]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        // Capture coords before setState — RN reuses synthetic events and
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
    if (path.length < 3) return null;
    const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
    return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
  }, [path]);

  const confirm = () => {
    if (!bbox) return;
    const c01 = (v: number) => Math.max(0, Math.min(1, v));
    onConfirm({
      x0: c01((bbox.minx - rect.ox) / rect.cw),
      y0: c01((bbox.miny - rect.oy) / rect.ch),
      x1: c01((bbox.maxx - rect.ox) / rect.cw),
      y1: c01((bbox.maxy - rect.oy) / rect.ch),
      tMs: 0,
    });
  };

  const pointsStr = path.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>Trace the runner</Text>

      <View
        style={[styles.frame, { backgroundColor: '#000', borderColor: colors.border }]}
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

      <View style={styles.actions}>
        <Pressable onPress={onSkip} hitSlop={10} accessibilityLabel="target-skip">
          <Text style={[styles.skip, { color: colors.muted }]}>Skip</Text>
        </Pressable>
        <Pressable
          onPress={confirm}
          disabled={!bbox}
          style={[styles.analyze, { backgroundColor: colors.accent, opacity: bbox ? 1 : 0.35 }]}
          accessibilityLabel="target-confirm"
        >
          <Check size={18} color={colors.accentText} strokeWidth={iconStroke + 0.5} />
          <Text style={[styles.analyzeText, { color: colors.accentText }]}>Analyze</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, padding: space.lg, gap: space.md, justifyContent: 'center', zIndex: 10 },
  title: { ...typo.h2, textAlign: 'center' },
  frame: { width: '100%', aspectRatio: 9 / 16, maxHeight: 540, alignSelf: 'center', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  hintWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space.lg },
  hint: { ...typo.caption, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, overflow: 'hidden' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.sm },
  skip: { ...typo.body },
  analyze: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill },
  analyzeText: { ...typo.body, fontWeight: '700' },
});
