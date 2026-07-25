import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';
import { strideApi, type OverlayData } from '../../services/api';
import { radius } from '../../ui/theme';
import { correctedFrameTimes } from '../../lib/overlaySync';

const EDGES: [number, number][] = [
  [5, 6], [5, 11], [6, 12], [11, 12],   // 0-3: shoulders, shoulder-hip x2, hips
  [5, 7], [7, 9], [6, 8], [8, 10],      // 4-7: left arm, right arm
  [11, 13], [13, 15], [12, 14], [14, 16], // 8-11: left thigh/shin, right thigh/shin
];
const ACCENT = '#FF453A';
const CONF = 0.3;
const FRAME_INTERVAL_MS = 55; // ~18fps loop — smooth enough for a small inline clip
const DIM_OPACITY = 0.3;

// Which EDGES indices (see comment above) are relevant to a given coach metric —
// used to highlight the athlete's own joints instead of drawing a generic diagram.
const METRIC_EDGES: Record<string, number[]> = {
  trunk_lean: [0, 1, 2, 3],
  knee_drive: [8, 10],
  hip_extension: [1, 2, 3, 8, 10],
  knee_flexion: [9, 11],
  arm_swing: [4, 5, 6, 7],
  overstride: [9, 11],
  vertical_oscillation: [0, 1, 2, 3],
  knee_valgus: [8, 9, 10, 11],
  pelvic_drop: [1, 2, 3],
  contact_time_ms: [8, 9, 10, 11],
  cadence_spm: [8, 9, 10, 11],
};
// Ankle keypoints, dimmed/highlighted alongside overstride's lower-leg edges.
const METRIC_KEYPOINTS: Record<string, number[]> = { overstride: [15, 16] };

/** A small looping skeleton animation of the athlete's own running form — reuses
 * the same cached overlay + letterboxing math as PoseSnapshot, but cycles
 * through the captured frames instead of holding on one. Used inline in coach
 * chat replies that discuss form. When `highlightMetricKey` is given, the
 * joints relevant to that metric are emphasized and the rest dimmed, so the
 * diagram reads as "this specific joint, on your own body" rather than a
 * generic pose. */
export function PoseLoop({ analysisId, highlightMetricKey }: { analysisId: string; highlightMetricKey?: string }) {
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

  const highlightEdges = highlightMetricKey ? METRIC_EDGES[highlightMetricKey] : undefined;
  const highlightKeypoints = highlightMetricKey ? METRIC_KEYPOINTS[highlightMetricKey] : undefined;

  return (
    <View style={styles.box} onLayout={(e: LayoutChangeEvent) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {frame && layout.w > 0 && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {EDGES.map(([a, b], i) => {
            const p = toPx(frame.kp[a]); const q = toPx(frame.kp[b]);
            if (p.c < CONF || q.c < CONF) return null;
            const isHighlighted = !highlightEdges || highlightEdges.includes(i);
            return (
              <Line
                key={i}
                x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                stroke={ACCENT}
                strokeWidth={isHighlighted ? 2.2 : 1.5}
                strokeOpacity={isHighlighted ? 0.9 : DIM_OPACITY}
                strokeLinecap="round"
              />
            );
          })}
          {frame.kp.map((kp, i) => {
            if (i < 5 || kp[2] < CONF) return null;
            const p = toPx(kp);
            const isHighlighted = !highlightKeypoints || highlightKeypoints.includes(i);
            return <Circle key={i} cx={p.x} cy={p.y} r={2} fill="#FFFFFF" fillOpacity={isHighlighted ? 1 : DIM_OPACITY} />;
          })}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', height: 96, borderRadius: radius.sm, backgroundColor: '#0A0C14', overflow: 'hidden' },
});
