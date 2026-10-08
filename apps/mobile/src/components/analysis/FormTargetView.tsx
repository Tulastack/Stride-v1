import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import { radius, space } from '../../theme';
import type { Metric } from '../../types/analysis';
import {
  BONES,
  idealSpec,
  poseAt,
  projectJoint,
  targetCaption,
  type Joint,
} from '../../lib/formTargetPose';

const FRAMES = 24;
const FRAME_MS = 70;

/**
 * Looping three-quarter model of the stride the athlete should be running.
 * Sits next to the 2D overlay, which draws their actual joints on the film.
 */
export function FormTargetView({ metrics }: { metrics: Metric[] }) {
  const { colors } = useTheme();
  const spec = useMemo(() => idealSpec(metrics), [metrics]);
  const caption = useMemo(() => targetCaption(spec, metrics), [spec, metrics]);
  const frames = useMemo(
    () => Array.from({ length: FRAMES }, (_, i) => poseAt(i / FRAMES, spec)),
    [spec],
  );
  const [frameIdx, setFrameIdx] = useState(0);
  const [layout, setLayout] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % FRAMES);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  const joints = frames[frameIdx];
  const byName = useMemo(() => {
    const map = new Map<string, Joint>();
    for (const j of joints) map.set(j.name, j);
    return map;
  }, [joints]);

  const projected = layout.w > 0
    ? BONES.map(([a, b]) => {
        const pa = projectJoint(byName.get(a)!, layout.w, layout.h);
        const pb = projectJoint(byName.get(b)!, layout.w, layout.h);
        return { a, b, pa, pb, depth: (pa.depth + pb.depth) / 2 };
      }).sort((p, q) => q.depth - p.depth)
    : [];

  const head = layout.w > 0 ? projectJoint(byName.get('head')!, layout.w, layout.h) : null;

  return (
    <View>
      <View
        accessibilityLabel="Target form animation"
        style={[styles.well, { backgroundColor: '#141310', borderColor: colors.border }]}
        onLayout={(e) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <Text style={[styles.badge, { color: colors.accent }]}>3D TARGET</Text>
        {layout.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Line
              x1={layout.w * 0.12}
              y1={layout.h * 0.86}
              x2={layout.w * 0.88}
              y2={layout.h * 0.86}
              stroke={colors.accent}
              strokeOpacity={0.28}
              strokeWidth={1}
            />
            {projected.map(({ a, b, pa, pb, depth }) => {
              const near = depth < 3.55;
              return (
                <Line
                  key={`${a}-${b}`}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={colors.accent}
                  strokeWidth={near ? 2.6 : 1.6}
                  strokeOpacity={near ? 0.95 : 0.38}
                  strokeLinecap="round"
                />
              );
            })}
            {head && (
              <Circle
                cx={head.x}
                cy={head.y - 7}
                r={7}
                stroke={colors.accent}
                strokeWidth={1.6}
                fill="none"
              />
            )}
          </Svg>
        )}
      </View>
      <Text style={[styles.caption, { color: colors.muted }]}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    width: '100%',
    height: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    zIndex: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  caption: { fontSize: 12, lineHeight: 17, marginTop: space.sm },
});
