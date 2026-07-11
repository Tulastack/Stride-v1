import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';
import { strideApi, type OverlayData } from '../../services/api';
import { radius } from '../../ui/theme';
import { correctedFrameTimes } from '../../lib/overlaySync';

const EDGES: [number, number][] = [
  [5, 6], [5, 11], [6, 12], [11, 12],
  [5, 7], [7, 9], [6, 8], [8, 10],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const ACCENT = '#FF453A';
const CONF = 0.3;
const FRAME_INTERVAL_MS = 55; // ~18fps loop — smooth enough for a small inline clip

/** A small looping skeleton animation of the athlete's own running form — reuses
 * the same cached overlay + letterboxing math as PoseSnapshot, but cycles
 * through the captured frames instead of holding on one. Used inline in coach
 * chat replies that discuss form. */
export function PoseLoop({ analysisId }: { analysisId: string }) {
  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [frameIdx, setFrameIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    strideApi.getOverlay(analysisId).then((o) => active && setOverlay(o)).catch(() => {});
    return () => { active = false; };
  }, [analysisId]);

  const frames = useMemo(() => (overlay ? correctedFrameTimes(overlay) : []), [overlay]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!frames.length) return;
    setFrameIdx(0);
    timer.current = setInterval(() => {
      setFrameIdx((i) => (i + 1) % frames.length);
    }, FRAME_INTERVAL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [frames.length]);

  const frame = frames[frameIdx] ?? null;

  const rect = useMemo(() => {
    const { w, h } = layout;
    const vw = overlay?.width ?? 9; const vh = overlay?.height ?? 16;
    if (!w || !h) return { ox: 0, oy: 0, cw: w, ch: h };
    const va = vw / vh; const wa = w / h;
    if (va > wa) { const ch = w / va; return { ox: 0, oy: (h - ch) / 2, cw: w, ch }; }
    const cw = h * va; return { ox: (w - cw) / 2, oy: 0, cw, ch: h };
  }, [layout, overlay]);

  const toPx = (kp: number[]) => ({ x: rect.ox + kp[1] * rect.cw, y: rect.oy + kp[0] * rect.ch, c: kp[2] });

  return (
    <View style={styles.box} onLayout={(e: LayoutChangeEvent) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {frame && layout.w > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {EDGES.map(([a, b], i) => {
            const p = toPx(frame.kp[a]); const q = toPx(frame.kp[b]);
            if (p.c < CONF || q.c < CONF) return null;
            return <Line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={ACCENT} strokeWidth={2} strokeOpacity={0.9} strokeLinecap="round" />;
          })}
          {frame.kp.map((kp, i) => {
            if (i < 5 || kp[2] < CONF) return null;
            const p = toPx(kp);
            return <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#FFFFFF" />;
          })}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', height: 96, borderRadius: radius.sm, backgroundColor: '#0A0C14', overflow: 'hidden' },
});
