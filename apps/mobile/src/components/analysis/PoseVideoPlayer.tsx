import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Slider from '@react-native-community/slider';
import Svg, { Line, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { strideApi } from '../../services/api';
import { semantic, spacing, radius } from '../../ui/theme';
import { correctedFrameTimes, pickOverlayFrame, type OverlayData } from '../../lib/overlaySync';

const EDGES: [number, number][] = [
  [5, 6], [5, 11], [6, 12], [11, 12],
  [5, 7], [7, 9], [6, 8], [8, 10],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const KP_CONF = 0.3;
const ACCENT = '#FF453A';

function angleAt(a: number[], b: number[], c: number[]): number {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const m = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1e-6;
  return Math.round((Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI);
}

/** Maps a normalized [y,x] keypoint into the letterboxed video content rect. */
function useContentRect(layout: { w: number; h: number }, video: { width: number; height: number }) {
  return useMemo(() => {
    const { w, h } = layout;
    if (!w || !h || !video.width || !video.height) return { ox: 0, oy: 0, cw: w, ch: h };
    const va = video.width / video.height;
    const wa = w / h;
    if (va > wa) { const ch = w / va; return { ox: 0, oy: (h - ch) / 2, cw: w, ch }; }
    const cw = h * va; return { ox: (w - cw) / 2, oy: 0, cw, ch: h };
  }, [layout, video]);
}

export function PoseVideoPlayer({ analysisId, seekToMs }: { analysisId: string; seekToMs?: number }) {
  const [uri, setUri] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const u = await strideApi.videoFileUrl(analysisId);
        if (active) setUri(u);
      } catch { if (active) setErr('Could not load video'); }
      try {
        const o = await strideApi.getOverlay(analysisId);
        if (active) setOverlay(o);
      } catch { /* overlay optional (older analyses) */ }
    })();
    return () => { active = false; };
  }, [analysisId]);

  if (err) return <View style={styles.frame}><Text style={styles.msg}>{err}</Text></View>;
  if (!uri) return <View style={styles.frame}><ActivityIndicator color={ACCENT} /></View>;
  return <Inner uri={uri} overlay={overlay} seekToMs={seekToMs} />;
}

function Inner({ uri, overlay, seekToMs }: { uri: string; overlay: OverlayData | null; seekToMs?: number }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; });
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [tMs, setTMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlayReady, setOverlayReady] = useState(true);
  const scrubbing = useRef(false);
  const seekSettle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncFrames = useMemo(
    () => (overlay ? correctedFrameTimes(overlay) : []),
    [overlay],
  );

  // ~16ms poll during playback for tighter AV sync; skip while scrubbing/settling seek.
  useEffect(() => {
    const id = setInterval(() => {
      if (scrubbing.current) return;
      const ct = (player.currentTime || 0) * 1000;
      setTMs(ct);
      if (player.duration) setDurMs(player.duration * 1000);
      setPlaying(player.playing);
    }, 16);
    return () => clearInterval(id);
  }, [player]);

  useEffect(() => {
    if (seekToMs != null && durMs > 0) {
      setOverlayReady(false);
      player.currentTime = seekToMs / 1000;
      player.pause();
      if (seekSettle.current) clearTimeout(seekSettle.current);
      seekSettle.current = setTimeout(() => {
        setTMs(seekToMs);
        setOverlayReady(true);
      }, 80);
    }
    return () => { if (seekSettle.current) clearTimeout(seekSettle.current); };
  }, [seekToMs, durMs, player]);

  const video = { width: overlay?.width ?? 9, height: overlay?.height ?? 16 };
  const rect = useContentRect(layout, video);
  const frame = useMemo(
    () => (overlayReady ? pickOverlayFrame(syncFrames, tMs) : null),
    [syncFrames, tMs, overlayReady],
  );

  const stepSec = 1 / (overlay?.sourceFps ?? overlay?.fps ?? 30);
  const toPx = (kp: number[]) => ({ x: rect.ox + kp[1] * rect.cw, y: rect.oy + kp[0] * rect.ch, c: kp[2] });

  return (
    <View style={styles.wrap}>
      <View style={styles.frame} onLayout={(e: LayoutChangeEvent) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        {frame && layout.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {EDGES.map(([a, b], i) => {
              const p = toPx(frame.kp[a]); const q = toPx(frame.kp[b]);
              if (p.c < KP_CONF || q.c < KP_CONF) return null;
              return <Line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={ACCENT} strokeWidth={2.5} strokeOpacity={0.85} strokeLinecap="round" />;
            })}
            {frame.kp.map((kp, i) => {
              if (i < 5 || kp[2] < KP_CONF) return null;
              const p = toPx(kp);
              return <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#FFFFFF" stroke={ACCENT} strokeWidth={1.5} />;
            })}
            {(() => {
              const side = frame.kp[13][2] >= frame.kp[14][2] ? [11, 13, 15] : [12, 14, 16];
              const [h, k, a] = side.map((i) => frame.kp[i]);
              if (h[2] < KP_CONF || k[2] < KP_CONF || a[2] < KP_CONF) return null;
              const ang = angleAt(h, k, a); const p = toPx(k);
              return (
                <>
                  <Rect x={p.x + 8} y={p.y - 12} width={54} height={20} rx={4} fill="#000000" fillOpacity={0.6} />
                  <SvgText x={p.x + 12} y={p.y + 2} fill="#FFFFFF" fontSize={12} fontWeight="700">{`knee ${ang}°`}</SvgText>
                </>
              );
            })()}
          </Svg>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={() => { player.currentTime = Math.max(0, (player.currentTime || 0) - stepSec); }} accessibilityLabel="step-back">
          <ChevronLeft color={semantic.text.primary} size={22} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => (playing ? player.pause() : player.play())} accessibilityLabel="play-pause">
          {playing ? <Pause color={ACCENT} size={26} /> : <Play color={ACCENT} size={26} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { player.currentTime = Math.min((durMs / 1000) || 0, (player.currentTime || 0) + stepSec); }} accessibilityLabel="step-forward">
          <ChevronRight color={semantic.text.primary} size={22} />
        </TouchableOpacity>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={durMs || 1}
          value={tMs}
          minimumTrackTintColor={ACCENT}
          maximumTrackTintColor={semantic.surface.overlay}
          thumbTintColor="#FFFFFF"
          onSlidingStart={() => { scrubbing.current = true; setOverlayReady(false); player.pause(); }}
          onValueChange={(v: number) => setTMs(v)}
          onSlidingComplete={(v: number) => {
            player.currentTime = v / 1000;
            if (seekSettle.current) clearTimeout(seekSettle.current);
            seekSettle.current = setTimeout(() => {
              setTMs(v);
              setOverlayReady(true);
              scrubbing.current = false;
            }, 60);
          }}
        />
        <Text style={styles.time}>{(tMs / 1000).toFixed(1)}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  frame: { width: '100%', aspectRatio: 9 / 16, maxHeight: 460, alignSelf: 'center', backgroundColor: '#000000', borderRadius: radius.md, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  msg: { color: semantic.text.muted },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  slider: { flex: 1, height: 32 },
  time: { color: semantic.text.secondary, fontSize: 12, width: 40, textAlign: 'right' },
});
