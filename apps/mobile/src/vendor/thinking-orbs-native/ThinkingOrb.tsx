// Port of thinking-orbs-native (MIT, Jakub Antalik).
// The package is not published on npm. Geometry comes from `thinking-orbs/engine`,
// the same code the web component runs. This file only turns a frame into Skia draws.
// Expo SDK 57 ships Skia 2.6, which records pictures with PictureRecorder
// rather than the newer createPicture helper.

import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Canvas, PaintStyle, Picture, Skia } from '@shopify/react-native-skia';
import type { SkCanvas, SkPaint, SkPicture } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { MODE_FRAMES, resolvePreset } from 'thinking-orbs/engine';
import { nowSeconds, useAppActive, useReducedMotion, useResolvedDark } from './theme';
import type { ThinkingOrbProps } from './types';

const LABELS: Record<string, string> = {
  working: 'Working',
  searching: 'Searching',
  solving: 'Solving',
  listening: 'Listening',
  connecting: 'Connecting',
  weaving: 'Weaving',
  composing: 'Composing',
  breathing: 'Thinking',
  shaping: 'Shaping',
};

/** The static frame reduced-motion users see. Same instant as the web build. */
const REDUCED_MOTION_T = 0.6;

function recordPicture(draw: (canvas: SkCanvas) => void, size: number): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, size, size));
  draw(canvas);
  return recorder.finishRecordingAsPicture();
}

export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  displaySize,
  accessibilityLabel,
  style,
}: ThinkingOrbProps) {
  const dark = useResolvedDark(theme);
  const reduced = useReducedMotion();
  const appActive = useAppActive();

  const empty = useMemo(() => recordPicture(() => {}, size), [size]);
  const picture = useSharedValue<SkPicture>(empty);
  const paints = useMemo(() => ({ fill: Skia.Paint(), stroke: Skia.Paint() }), []);
  const rgba = useRef(new Float32Array(4)).current;

  const { mode, speed: baseSpeed, opts } = useMemo(() => resolvePreset(state, size), [state, size]);
  const effSpeed = baseSpeed * speed;
  const box = displaySize ?? size;
  const zoom = box / size;

  useEffect(() => {
    const { fill, stroke } = paints;
    fill.setAntiAlias(true);
    stroke.setAntiAlias(true);
    stroke.setStyle(PaintStyle.Stroke);

    const build = MODE_FRAMES[mode];

    const setInk = (paint: SkPaint, white: number, alpha: number) => {
      const w = Math.min(1, Math.max(0, white));
      const g = Math.round((dark ? 1 - w : w) * 255) / 255;
      rgba[0] = g;
      rgba[1] = g;
      rgba[2] = g;
      rgba[3] = alpha;
      paint.setColor(rgba);
    };

    const record = (t: number) => {
      const frame = build(size, t, opts);
      picture.value = recordPicture((canvas) => {
        if (zoom !== 1) canvas.scale(zoom, zoom);
        for (const line of frame.lines) {
          setInk(stroke, line.white, line.a ?? 1);
          stroke.setStrokeWidth(line.w);
          canvas.drawLine(line.x1, line.y1, line.x2, line.y2, stroke);
        }
        for (const dot of frame.dots) {
          setInk(fill, dot.white, dot.a ?? 1);
          canvas.drawCircle(dot.x, dot.y, dot.r, fill);
        }
      }, box);
    };

    if (reduced) {
      record(REDUCED_MOTION_T);
      return;
    }

    record(nowSeconds() * effSpeed);
    if (paused || !appActive) return;

    let raf = 0;
    let running = true;
    const loop = () => {
      record(nowSeconds() * effSpeed);
      if (running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [mode, opts, size, box, zoom, dark, effSpeed, paused, reduced, appActive, paints, rgba, picture]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? LABELS[state]}
      style={[{ width: box, height: box }, style]}
    >
      <Canvas style={{ width: box, height: box }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}
