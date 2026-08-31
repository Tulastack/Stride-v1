// Streak counter. Sits quiet most of the time and celebrates on the frame the
// number actually goes up: the flame pops, a ring bursts outward, and the digits
// roll to the new total.
//
// A streak with unfinished work today is drawn hollow — the day is live but not
// yet banked, and claiming it early would be a lie the athlete can check.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Flame } from 'lucide-react-native';
import type { Palette } from '../../theme';
import { radius, space } from '../../theme';

const ROLL_MS = 560;
const BURST_MS = 720;

export interface StreakBadgeProps {
  value: number;
  atRisk?: boolean;
  colors: Palette;
  /** Bump to replay the celebration without the number changing (post-fold). */
  celebrateKey?: number;
  testID?: string;
}

export function StreakBadge({ value, atRisk = false, colors, celebrateKey = 0, testID }: StreakBadgeProps) {
  // The digits are their own state so they can roll up one at a time; only a
  // handful of renders, well short of anything that would cost a frame.
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  const pop = useSharedValue(0);
  const burst = useSharedValue(0);

  const celebrate = () => {
    pop.value = withSequence(
      withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 7, stiffness: 170 }),
    );
    burst.value = 0;
    burst.value = withTiming(1, { duration: BURST_MS, easing: Easing.out(Easing.cubic) });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  useEffect(() => {
    if (value === prev.current) {
      setShown(value);
      return;
    }
    const from = prev.current;
    prev.current = value;

    // Only a gain is worth celebrating; a reset should land quietly.
    if (value < from) {
      setShown(value);
      return;
    }

    celebrate();

    // Roll the digits across the pop rather than snapping to the new total.
    const steps = Math.min(value - from, 12);
    const stepMs = Math.max(40, ROLL_MS / steps);
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      const next = from + Math.round(((value - from) * i) / steps);
      setShown(next);
      if (i >= steps) clearInterval(timer);
    }, stepMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Lets the calendar replay the flourish once the cards have folded in, even
  // when the streak number itself did not move.
  useEffect(() => {
    if (celebrateKey > 0) celebrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrateKey]);

  const flameStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(pop.value, [0, 1], [1, 1.45], Extrapolation.CLAMP) },
      { rotate: `${interpolate(pop.value, [0, 1], [0, -9], Extrapolation.CLAMP)}deg` },
    ],
  }));

  const burstStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.15, 1], [0, 0.55, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(burst.value, [0, 1], [0.5, 2.4], Extrapolation.CLAMP) }],
  }));

  const numberStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pop.value, [0, 1], [1, 1.2], Extrapolation.CLAMP) }],
  }));

  const tint = atRisk ? colors.muted : colors.accent;

  return (
    <View
      style={[styles.wrap, { borderColor: atRisk ? colors.border : tint, backgroundColor: colors.cardAlt }]}
      testID={testID}
      accessibilityLabel={`Streak: ${value} ${value === 1 ? 'day' : 'days'}${atRisk ? ', today not done yet' : ''}`}
    >
      <Animated.View style={[styles.burst, { borderColor: tint }, burstStyle]} pointerEvents="none" />
      <Animated.View style={flameStyle}>
        <Flame
          size={19}
          color={tint}
          strokeWidth={2.3}
          // Hollow while today is still unfinished; filled once it is banked.
          fill={atRisk ? 'transparent' : tint}
        />
      </Animated.View>
      <Animated.Text style={[styles.value, { color: tint }, numberStyle]}>{shown}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  burst: {
    position: 'absolute',
    left: 8,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  value: { fontSize: 17, fontWeight: '900', letterSpacing: -0.3, minWidth: 16, textAlign: 'center' },
});
