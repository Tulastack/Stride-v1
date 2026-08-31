// One training day, as a card in the deck. The front is a tear-off calendar
// page — weekday, the day numeral, and what the day is for. Nothing else earns
// its place there. Tapping flips it to the session list.
//
// Presentational: the stack owns the pan gesture and hands down `stackStyle`,
// so this file only deals with the flip and the swipe feedback.
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Check, X } from 'lucide-react-native';
import type { Palette } from '../../theme';
import { space, radius } from '../../theme';
import { EVENT_TYPE_COLORS, volumeLabel, type PlanDayCard } from '../../lib/planCards';

// A half-turn reads as a flip rather than a spin at this duration.
const FLIP_MS = 420;

export interface DayCardProps {
  card: PlanDayCard;
  colors: Palette;
  width: number;
  height: number;
  /** Deck placement + swipe transform, owned by PlanCardStack. */
  stackStyle?: StyleProp<ViewStyle>;
  /** Only the top card is interactive; the deck behind it is scenery. */
  interactive?: boolean;
  /** Normalised drag. -1 = committed left, +1 = committed right/up. */
  swipeX?: Readonly<SharedValue<number>>;
  swipeUp?: Readonly<SharedValue<number>>;
  testID?: string;
}

export function DayCard({
  card,
  colors,
  width,
  height,
  stackStyle,
  interactive = false,
  swipeX,
  swipeUp,
  testID,
}: DayCardProps) {
  // 0 = front, 1 = back. Shared so the flip runs on the UI thread.
  const flip = useSharedValue(0);
  const accent = EVENT_TYPE_COLORS[card.focusType];

  const onFlip = useCallback(() => {
    flip.value = withTiming(flip.value > 0.5 ? 0 : 1, {
      duration: FLIP_MS,
      easing: Easing.inOut(Easing.cubic),
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [flip]);

  const tap = Gesture.Tap()
    .enabled(interactive)
    .maxDistance(12) // a drag is a swipe, not a tap
    .onEnd((_e, success) => {
      if (success) onFlip();
    })
    .runOnJS(true);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` },
    ],
    // backfaceVisibility alone is unreliable across platforms, so each face is
    // also faded the moment it turns past edge-on.
    opacity: flip.value < 0.5 ? 1 : 0,
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` },
    ],
    opacity: flip.value < 0.5 ? 0 : 1,
  }));

  // Swipe feedback is a wash of colour and a single mark — no stamped words.
  // The athlete should feel the decision, not read it.
  const keepWash = useAnimatedStyle(() => {
    if (!swipeX || !swipeUp) return { opacity: 0 };
    const t = Math.max(Math.max(0, swipeX.value), Math.max(0, swipeUp.value));
    return { opacity: interpolate(t, [0, 1], [0, 0.92], Extrapolation.CLAMP) };
  });

  const dropWash = useAnimatedStyle(() => {
    if (!swipeX) return { opacity: 0 };
    return { opacity: interpolate(-swipeX.value, [0, 1], [0, 0.92], Extrapolation.CLAMP) };
  });

  const face: ViewStyle = {
    width,
    height,
    backgroundColor: colors.card,
    borderColor: colors.border,
  };

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[styles.wrapper, { width, height }, stackStyle]} testID={testID}>
        {/* ── Front ─────────────────────────────────────────────── */}
        <Animated.View style={[styles.face, face, frontStyle]}>
          <View style={styles.head}>
            <View style={[styles.mark, { backgroundColor: accent }]} />
            <Text style={[styles.weekday, { color: colors.muted }]}>
              {card.weekday}
              {'   '}
              {card.month}
            </Text>
          </View>

          <View style={styles.hero}>
            <Text style={[styles.numeral, { color: colors.text }]} allowFontScaling={false}>
              {card.dayNumber}
            </Text>
          </View>

          <View style={styles.foot}>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            <Text style={[styles.focus, { color: colors.text }]} numberOfLines={2}>
              {card.focus}
            </Text>
          </View>

          {interactive ? (
            <>
              <Animated.View
                style={[styles.wash, { backgroundColor: colors.card }, keepWash]}
                pointerEvents="none"
              >
                <View style={[styles.washMark, { borderColor: colors.success }]}>
                  <Check size={38} color={colors.success} strokeWidth={2.6} />
                </View>
              </Animated.View>
              <Animated.View
                style={[styles.wash, { backgroundColor: colors.card }, dropWash]}
                pointerEvents="none"
              >
                <View style={[styles.washMark, { borderColor: colors.error }]}>
                  <X size={38} color={colors.error} strokeWidth={2.6} />
                </View>
              </Animated.View>
            </>
          ) : null}
        </Animated.View>

        {/* ── Back ──────────────────────────────────────────────── */}
        <Animated.View style={[styles.face, face, backStyle]}>
          <View style={styles.head}>
            <View style={[styles.mark, { backgroundColor: accent }]} />
            <Text style={[styles.weekday, { color: colors.muted }]}>
              {card.weekday}
              {'   '}
              {card.month} {card.dayNumber}
            </Text>
          </View>

          <View style={styles.list}>
            {card.events.map((event) => {
              const volume = volumeLabel(event);
              return (
                <View key={event.id} style={styles.item}>
                  <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
                    {event.title}
                  </Text>
                  {volume ? (
                    <Text style={[styles.itemVolume, { color: colors.muted }]}>{volume}</Text>
                  ) : null}
                  {event.details?.cue ? (
                    <Text style={[styles.itemCue, { color: colors.muted }]} numberOfLines={3}>
                      {event.details.cue}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute' },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.xl,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    // One soft shadow so the deck reads as physical without looking sprayed on.
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The only place the day's category shows up. A stripe down the edge would
  // read as a dashboard row; a single small mark reads as a considered detail.
  mark: { width: 7, height: 7 },
  weekday: { fontSize: 12, fontWeight: '800', letterSpacing: 2.2 },

  // The card's whole hierarchy rests on this numeral, the way a tear-off
  // calendar page does. It fills the middle so the card reads as one composed
  // page rather than a header and a footer with a hole between them.
  // allowFontScaling is off: an accessibility text size would push a two-digit
  // date past the card edge.
  hero: { flex: 1, justifyContent: 'center' },
  numeral: { fontSize: 150, fontWeight: '900', letterSpacing: -9, lineHeight: 134 },

  foot: { gap: 10 },
  rule: { height: 1, width: 44 },
  focus: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, lineHeight: 28 },

  list: { flex: 1, justifyContent: 'center', gap: space.xl },
  item: { gap: 3 },
  itemTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  itemVolume: { fontSize: 15, fontWeight: '700' },
  itemCue: { fontSize: 14, lineHeight: 19 },

  wash: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  washMark: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
