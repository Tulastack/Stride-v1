import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Slider from '@react-native-community/slider';
import Svg, { Line, Circle, Path, Polyline } from 'react-native-svg';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { strideApi } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import { space, type as typo } from '../../theme';
import { IconButton, Button } from '../../ui';
import { correctedFrameTimes, pickOverlayFrame, type OverlayData } from '../../lib/overlaySync';
import { measuredJointAngle, preferredSide, jointIndices, type Joint } from '../../lib/poseInstrument';

const EDGES: [number, number][] = [[5, 6], [5, 11], [6, 12], [11, 12], [5, 7], [7, 9], [6, 8], [8, 10], [11, 13], [13, 15], [12, 14], [14, 16]];

export function PoseVideoPlayer({ analysisId, seekToMs }: { analysisId: string; seekToMs?: number }) {
  const { colors } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setUri(null); setOverlay(null); setError('');
    strideApi.videoFileUrl(analysisId).then((value) => { if (active) setUri(value); }).catch(() => { if (active) setError('Could not load video.'); });
    strideApi.getOverlay(analysisId).then((value) => { if (active) setOverlay(value); }).catch(() => {});
    return () => { active = false; };
  }, [analysisId, attempt]);
  if (error) return <View style={styles.unavailable}><Text style={[typo.body, { color: colors.wellMuted }]}>{error}</Text><Button label="Reload film" onPress={() => setAttempt(attempt + 1)} /></View>;
  if (!uri) return <View style={styles.unavailable}><ActivityIndicator color={colors.accent} /><Text style={[typo.caption, { color: colors.wellMuted }]}>Loading your film</Text></View>;
  return <Film key={analysisId + attempt} uri={uri} overlay={overlay} seekToMs={seekToMs} />;
}

function Film({ uri, overlay, seekToMs }: { uri: string; overlay: OverlayData | null; seekToMs?: number }) {
  const { colors } = useTheme();
  const player = useVideoPlayer(uri, (video) => { video.loop = false; video.muted = true; });
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [chartWidth, setChartWidth] = useState(0);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(true);
  const [joint, setJoint] = useState<Joint>('knee');
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [trails, setTrails] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const scrubbing = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frames = useMemo(() => overlay ? correctedFrameTimes(overlay) : [], [overlay]);
  const right = useMemo(() => preferredSide(frames, joint), [frames, joint]);
  const indices = jointIndices(joint, right);
  const nearestFrame = ready ? pickOverlayFrame(frames, timeMs) : null;
  const sampleWindowMs = 1000 / (overlay?.fps || 15);
  const frame = nearestFrame && Math.abs(nearestFrame.tMs - timeMs) <= sampleWindowMs ? nearestFrame : null;
  const angle = frame ? measuredJointAngle(frame, joint, right, overlay?.width, overlay?.height) : null;
  const rect = useMemo(() => {
    const width = overlay?.width ?? 9, height = overlay?.height ?? 16;
    if (!layout.width || !layout.height) return { x: 0, y: 0, width: 0, height: 0 };
    const scale = Math.min(layout.width / width, layout.height / height);
    return { x: (layout.width - width * scale) / 2, y: (layout.height - height * scale) / 2, width: width * scale, height: height * scale };
  }, [layout, overlay]);
  const pointPx = (point: number[]) => ({ x: rect.x + point[1] * rect.width, y: rect.y + point[0] * rect.height });
  const seek = (value: number) => {
    scrubbing.current = true; setReady(false); player.pause();
    const bounded = Math.max(0, Math.min(durationMs, value));
    player.currentTime = bounded / 1000; setTimeMs(bounded);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { setReady(true); scrubbing.current = false; }, 80);
  };
  useEffect(() => {
    const timer = setInterval(() => {
      if (scrubbing.current) return;
      setTimeMs((player.currentTime || 0) * 1000);
      setDurationMs((player.duration || 0) * 1000);
      setPlaying(player.playing);
    }, 33);
    return () => { clearInterval(timer); if (settle.current) clearTimeout(settle.current); };
  }, [player]);
  useEffect(() => {
    const subscription = player.addListener?.('statusChange', (event) => { if (event.status === 'error') setPlaybackError('The video could not be played. Return to capture or reload the report.'); });
    return () => subscription?.remove();
  }, [player]);
  useEffect(() => { if (seekToMs != null && durationMs > 0) seek(seekToMs); }, [seekToMs, durationMs]);

  const series = useMemo(() => frames.map((item) => ({ time: item.tMs, value: measuredJointAngle(item, joint, right, overlay?.width, overlay?.height) })), [frames, joint, right, overlay]);
  const chartEnd = Math.max(durationMs, frames[frames.length - 1]?.tMs ?? 1);
  const chartPath = series.reduce((path, item, index) => {
    if (item.value == null) return path;
    const previousValid = index > 0 && series[index - 1].value != null && item.time - series[index - 1].time <= sampleWindowMs * 2;
    return path + `${previousValid ? 'L' : 'M'}${12 + item.time / chartEnd * 296},${84 - item.value / 180 * 64} `;
  }, '');
  const tail = trails ? frames.filter((item) => item.tMs <= timeMs && item.tMs >= timeMs - 350).slice(-7).flatMap((item) => {
    const point = item.kp[indices[1]];
    return point && point[2] >= 0.5 ? [pointPx(point)] : [];
  }) : [];

  return <View style={{ gap: 12, backgroundColor: colors.well }}>
    <View style={styles.frame} onLayout={(event: LayoutChangeEvent) => setLayout({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {overlayVisible && frame && layout.width ? <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {tail.length > 1 ? <Polyline points={tail.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={4} opacity={0.35} /> : null}
        {EDGES.map(([first, last], index) => {
          const start = frame.kp[first], end = frame.kp[last];
          if (!start || !end || start[2] < 0.5 || end[2] < 0.5) return null;
          const startPx = pointPx(start), endPx = pointPx(end);
          const highlighted = indices.includes(first) && indices.includes(last);
          return <Line key={index} x1={startPx.x} y1={startPx.y} x2={endPx.x} y2={endPx.y} stroke={highlighted ? colors.accent : colors.wellText} strokeWidth={highlighted ? 2.4 : 1.4} strokeOpacity={highlighted ? 1 : 0.55} strokeLinecap="round" />;
        })}
        {frame.kp.map((point, index) => {
          if (index < 5 || point[2] < 0.5) return null;
          const pixel = pointPx(point);
          return <Circle key={index} cx={pixel.x} cy={pixel.y} r={indices.includes(index) ? 3.4 : 2} fill={indices.includes(index) ? colors.accent : colors.wellText} />;
        })}
      </Svg> : null}
    </View>
    <View style={styles.controls}>
      <IconButton testID="step-back" label="Step back one frame" onPress={() => seek(timeMs - 1000 / (overlay?.sourceFps ?? overlay?.fps ?? 30))}><ChevronLeft size={20} color={colors.wellText} /></IconButton>
      <IconButton testID="play-pause" label={playing ? 'Pause video' : 'Play video'} onPress={() => playing ? player.pause() : player.play()}>{playing ? <Pause color={colors.accent} size={22} /> : <Play color={colors.accent} size={22} />}</IconButton>
      <IconButton testID="step-forward" label="Step forward one frame" onPress={() => seek(timeMs + 1000 / (overlay?.sourceFps ?? overlay?.fps ?? 30))}><ChevronRight size={20} color={colors.wellText} /></IconButton>
      <Slider accessibilityLabel="Scrub running video" style={{ flex: 1 }} minimumValue={0} maximumValue={durationMs || 1} value={timeMs} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.wellBorder} thumbTintColor={colors.accent} onSlidingStart={() => { scrubbing.current = true; setReady(false); player.pause(); }} onValueChange={(value: number) => setTimeMs(value)} onSlidingComplete={seek} />
      <Text style={[typo.caption, { color: colors.wellMuted, fontVariant: ['tabular-nums'] }]}>{(timeMs / 1000).toFixed(1)}s</Text>
    </View>
    {playbackError ? <Text style={[typo.caption, { color: colors.wellText, paddingHorizontal: 16 }]}>{playbackError}</Text> : null}
    {frames.length ? <View style={styles.instrument}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[typo.label, { color: colors.wellMuted }]}>{right ? 'RIGHT' : 'LEFT'} {joint.toUpperCase()} / 2D ANGLE</Text><Text style={[typo.bodyMedium, { color: colors.accent, fontVariant: ['tabular-nums'] }]}>{angle == null ? 'Withheld' : `${angle}°`}</Text></View>
      <Pressable accessibilityRole="adjustable" accessibilityLabel="Joint angle timeline" accessibilityValue={{ min: 0, max: durationMs, now: timeMs, text: `${(timeMs / 1000).toFixed(1)} seconds` }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(event) => seek(timeMs + (event.nativeEvent.actionName === 'increment' ? 1 : -1) * 1000 / (overlay?.sourceFps || overlay?.fps || 30))} onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)} onPress={(event) => { if (chartWidth) seek(Math.max(0, Math.min(1, (event.nativeEvent.locationX / chartWidth * 320 - 12) / 296)) * chartEnd); }}>
        <Svg width="100%" height={100} viewBox="0 0 320 100">{[20, 52, 84].map((height) => <Line key={height} x1="12" x2="308" y1={height} y2={height} stroke={colors.wellBorder} strokeWidth={0.5} />)}<Path d={chartPath} stroke={colors.accent} strokeWidth={2} fill="none" />{ready ? <Line x1={12 + timeMs / chartEnd * 296} x2={12 + timeMs / chartEnd * 296} y1="10" y2="90" stroke={colors.wellText} strokeWidth={1} /> : null}</Svg>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 4 }}>{(['knee', 'hip', 'elbow'] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: joint === value }} onPress={() => setJoint(value)} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: joint === value ? 1 : 0, borderColor: colors.accent }}><Text style={[typo.caption, { color: joint === value ? colors.accent : colors.wellMuted }]}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text></Pressable>)}</View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Pressable accessibilityRole="switch" accessibilityState={{ checked: overlayVisible }} onPress={() => setOverlayVisible(!overlayVisible)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[typo.caption, { color: colors.wellMuted }]}>Overlay {overlayVisible ? 'on' : 'off'}</Text></Pressable><Pressable accessibilityRole="switch" accessibilityState={{ checked: trails }} onPress={() => setTrails(!trails)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[typo.caption, { color: colors.wellMuted }]}>Motion trail {trails ? 'on' : 'off'}</Text></Pressable></View>
      <Text style={[typo.tiny, { color: colors.wellMuted }]}>Angle from tracked 2D joints · gaps are low-confidence frames · not a 3D reconstruction</Text>
    </View> : <Text style={[typo.caption, { color: colors.wellMuted, padding: 16 }]}>No tracking overlay available for this film. Your original video is still playable.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  unavailable: { height: 220, justifyContent: 'center', alignItems: 'center', gap: 16 },
  frame: { width: '100%', height: 320, overflow: 'hidden' },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  instrument: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: 8 },
});
