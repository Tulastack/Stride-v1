import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';
import { strideApi, type OverlayData } from '../../services/api';
import { radius } from '../../ui/theme';
import { correctedFrameTimes, pickOverlayFrame } from '../../lib/overlaySync';

const EDGES: [number, number][] = [
  [5, 6], [5, 11], [6, 12], [11, 12],
  [5, 7], [7, 9], [6, 8], [8, 10],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const ACCENT = '#FF453A';
const CONF = 0.3;

/** A static skeleton snapshot of the athlete's own pose at a given timestamp —
 * the "your form" reference on each drill card. Reuses the cached overlay. */
export function PoseSnapshot({ analysisId, tMs }: { analysisId: string; tMs: number }) {
  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [layout, setLayout] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let active = true;
    strideApi.getOverlay(analysisId).then((o) => active && setOverlay(o)).catch(() => {});
    return () => { active = false; };
  }, [analysisId]);

  const frames = useMemo(() => (overlay ? correctedFrameTimes(overlay) : []), [overlay]);
  const frame = useMemo(() => pickOverlayFrame(frames, tMs), [frames, tMs]);

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
  box: { width: '100%', height: 84, borderRadius: radius.sm, backgroundColor: '#0A0C14', overflow: 'hidden' },
});
