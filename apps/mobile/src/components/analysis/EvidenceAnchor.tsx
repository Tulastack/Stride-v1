// Evidence anchor (PROMPT F.3, layout item 1): freeze-frame at the worst flaw's
// evidence frame with a skeleton overlay; the single offending joint glows in
// status.flaw. A scrub bar steps frames. This is the screen's one dominant element.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';
import { semantic, spacing, radius, borderWidth, typography } from '../../ui/theme';
import type { Flaw } from '../../types/analysis';

// A stylized sprint pose (normalized 0..1 coords) — stand-in for the real
// MoveNet overlay until video frames are wired (demoAssetId pattern).
const POSE: Record<string, [number, number]> = {
  head: [0.52, 0.12],
  neck: [0.5, 0.22],
  l_shoulder: [0.44, 0.24],
  r_shoulder: [0.56, 0.24],
  l_hip: [0.46, 0.5],
  r_hip: [0.54, 0.5],
  l_knee: [0.4, 0.68],
  r_knee: [0.62, 0.66],
  l_ankle: [0.36, 0.86],
  r_ankle: [0.7, 0.82],
};
const BONES: [string, string][] = [
  ['head', 'neck'], ['neck', 'l_shoulder'], ['neck', 'r_shoulder'],
  ['l_shoulder', 'l_hip'], ['r_shoulder', 'r_hip'], ['l_hip', 'r_hip'],
  ['l_hip', 'l_knee'], ['l_knee', 'l_ankle'], ['r_hip', 'r_knee'], ['r_knee', 'r_ankle'],
];

// Which joint to glow per flaw key.
function offendingJoint(flaw: Flaw): string {
  if (/knee/i.test(flaw.name)) return 'l_knee';
  if (/hip/i.test(flaw.name)) return 'r_hip';
  if (/trunk|pop/i.test(flaw.name)) return 'neck';
  if (/overstr|shin/i.test(flaw.name)) return 'l_ankle';
  return 'neck';
}

const W = 280;
const H = 280;

export function EvidenceAnchor({ flaw, testID }: { flaw: Flaw; testID?: string }) {
  const [frame, setFrame] = useState(2);
  const joint = offendingJoint(flaw);
  const baseTs = flaw.evidence.frameTimestampMs;
  const ts = baseTs + (frame - 2) * 8; // ~120fps steps

  return (
    <View style={styles.wrap} testID={testID} accessibilityLabel="evidence-anchor">
      <View style={styles.canvas}>
        <Svg width={W} height={H}>
          {BONES.map(([a, b], i) => (
            <Line
              key={i}
              x1={POSE[a][0] * W}
              y1={POSE[a][1] * H}
              x2={POSE[b][0] * W}
              y2={POSE[b][1] * H}
              stroke={semantic.text.secondary}
              strokeWidth={2}
            />
          ))}
          {Object.entries(POSE).map(([name, [x, y]]) => {
            const glow = name === joint;
            return (
              <Circle
                key={name}
                cx={x * W}
                cy={y * H}
                r={glow ? 9 : 4}
                fill={glow ? semantic.status.flaw : semantic.text.muted}
              />
            );
          })}
        </Svg>
        <Text style={styles.tsLabel}>t = {ts}ms</Text>
      </View>

      <View style={styles.scrub} accessibilityLabel="evidence-scrub">
        {[0, 1, 2, 3, 4].map((i) => (
          <Pressable
            key={i}
            testID={`scrub-${i}`}
            onPress={() => setFrame(i)}
            style={[styles.tick, i === frame && styles.tickActive]}
          />
        ))}
      </View>
      <Text style={styles.caption}>Tap to step frames · offending joint in red</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: semantic.surface.raised,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  canvas: { width: W, height: H, alignItems: 'center', justifyContent: 'center' },
  tsLabel: { ...(typography.metricSmall as object), color: semantic.text.muted, position: 'absolute', bottom: 0, right: 0 },
  scrub: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  tick: { width: 36, height: 4, borderRadius: 2, backgroundColor: semantic.surface.sunken },
  tickActive: { backgroundColor: semantic.action.primary, height: 6 },
  caption: { ...(typography.caption as object), color: semantic.text.muted },
});
