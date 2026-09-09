// What the coach is doing while it works, drawn as a branch of thoughts rather
// than a single pill that swaps its own text. Each step stays on screen and a
// line runs down to the next one, so the athlete can see the reasoning
// accumulate instead of watching one label flicker.
//
// The whole block is transient: the caller unmounts it the moment the real
// answer lands, and nothing from it is kept in the thread.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import type { Palette } from '../theme';
import { space, radius } from '../theme';

const NODE = 9;
const RAIL = 1;
/** Row height is fixed so the connector between two nodes is a known length. */
const ROW_GAP = space.md;

export interface CoachThinkingProps {
  /** Oldest first. The last entry is the step happening right now. */
  steps: string[];
  colors: Palette;
  testID?: string;
}

export function CoachThinking({ steps, colors, testID }: CoachThinkingProps) {
  if (!steps.length) return null;

  return (
    <View
      style={[styles.box, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}
      testID={testID ?? 'coach-thinking'}
      accessibilityLabel="coach-thinking"
    >
      {steps.map((step, i) => (
        <ThoughtRow
          key={`${i}-${step}`}
          label={step}
          colors={colors}
          active={i === steps.length - 1}
          last={i === steps.length - 1}
        />
      ))}
    </View>
  );
}

/**
 * One thought. The node is a small square that fills once the step is done; the
 * live step keeps a soft pulse so the block reads as still working.
 */
function ThoughtRow({
  label,
  colors,
  active,
  last,
}: {
  label: string;
  colors: Palette;
  active: boolean;
  last: boolean;
}) {
  // Rows arrive one at a time, so each fades and slides in on mount rather than
  // the list snapping to a new height.
  const enter = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [enter]);

  useEffect(() => {
    if (!active) {
      pulse.value = withTiming(0, { duration: 200 });
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 620, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [active, pulse]);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: interpolate(enter.value, [0, 1], [6, 0], Extrapolation.CLAMP) }],
  }));

  const nodeStyle = useAnimatedStyle(() => ({
    opacity: active ? interpolate(pulse.value, [0, 1], [0.45, 1], Extrapolation.CLAMP) : 1,
  }));

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      <View style={styles.rail}>
        <Animated.View
          style={[
            styles.node,
            { borderColor: colors.accent, backgroundColor: active ? 'transparent' : colors.accent },
            nodeStyle,
          ]}
        />
        {/* The line to the next thought. The newest step has nothing below it
            yet, so it ends the branch. */}
        {last ? null : <View style={[styles.connector, { backgroundColor: colors.border }]} />}
      </View>
      <Text style={[styles.label, { color: active ? colors.text : colors.muted }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: ROW_GAP,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  // The rail owns both the node and the line beneath it, so the connector is
  // anchored to the node rather than guessed at from the row's height.
  rail: { width: NODE, alignItems: 'center', paddingTop: 4 },
  node: { width: NODE, height: NODE, borderRadius: 2, borderWidth: 1.5 },
  connector: {
    position: 'absolute',
    top: 4 + NODE,
    width: RAIL,
    // Reaches the next row's node: the remaining row height plus the list gap.
    height: ROW_GAP + 4,
  },
  label: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
