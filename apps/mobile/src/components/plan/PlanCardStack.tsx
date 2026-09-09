// Full-screen reveal for work the coach or the analysis engine just scheduled.
// Cards fill the page and fan out like a hand held at the table; the top one
// follows the finger and flies off on release.
//
// Two directions, and only two:
//   RIGHT  moves on to the next day, so the athlete can look through what was
//          scheduled one card at a time.
//   UP     takes the whole plan. Every card still in the deck lifts and folds
//          into the calendar together.
// Left and down spring back. There is no third gesture to discover and no way
// to end up somewhere the deck cannot explain.
//
// Everything that moves per-frame is a shared value driven on the UI thread,
// no setState in the gesture path, so the drag stays at display rate.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import type { Palette } from '../../theme';
import { space } from '../../theme';
import { DayCard } from './DayCard';
import type { PlanDayCard } from '../../lib/planCards';

/** Cards drawn behind the top one. Enough for the fan to read as a deck. */
const VISIBLE_DEPTH = 3;
// The deck fans like a hand of cards. Each card further back turns a little
// more about a pivot at its OWN BOTTOM EDGE, so the cards splay from a shared
// point at the base and their tops sweep an arc, that pivot is the whole
// difference between a fanned hand and a pile of offset rectangles. The angle
// is small now that a card fills the page: at full size, 4.5° threw the corners
// clean off the screen.
const FAN_STEP_DEG = 1.6;
/** Fraction of the card width a drag must pass to count as a decision. */
const X_THRESHOLD = 0.3;
const Y_THRESHOLD = 0.18;
/** A fast flick commits even when it never crossed the distance threshold. */
const VELOCITY_THRESHOLD = 700;
const FLY_MS = 230;
const FOLD_MS = 620;
// How far up the screen the folding stack travels, and how small it gets, as it
// converges on the calendar grid sitting behind the takeover.
const FOLD_LIFT = 0.55;
const FOLD_SCALE = 0.28;

export interface PlanCardStackProps {
  cards: PlanDayCard[];
  colors: Palette;
  /** Fired per card as it is taken: on a right swipe, and for the rest on up. */
  onAccept: (card: PlanDayCard) => void;
  /** Every remaining card was dismissed at once. */
  onSkipAll: (remaining: PlanDayCard[]) => void;
  /** Stack is finished and has folded away, play the calendar bounce now. */
  onDone: () => void;
}

export function PlanCardStack({ cards, colors, onAccept, onSkipAll, onDone }: PlanCardStackProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  // The card is the page. A small card in the middle of a dimmed screen made
  // every session on it fight for room; at this size the day can just be read.
  const cardW = winW - space.xl * 2;
  const cardH = Math.min(winH * 0.74, cardW * 1.62);
  // Pivot at the card's own bottom edge, in its local coordinates.
  const fanPivot = cardH / 2;
  // The fan only opens to the right, so the deck's visual mass would sit right
  // of centre. Nudging the stage back by half the spread re-centres the hand
  // and keeps the outermost card inside the frame.
  const fanSpread = cardH * Math.sin((VISIBLE_DEPTH * FAN_STEP_DEG * Math.PI) / 180);
  const fanShift = fanSpread / 2;

  const [index, setIndex] = useState(0);
  const [folding, setFolding] = useState(false);
  // While the top card is showing its session list, the list owns vertical
  // drags. Panning at the same time would make the card fly off mid-read.
  const [reading, setReading] = useState(false);

  // Top-card drag offset.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // 0 while the stack is live, 1 once it has folded into the calendar.
  const fold = useSharedValue(0);

  // Normalised drag, so the card's swipe feedback doesn't need to know the
  // screen size. 1 means "released here and it commits".
  const swipeUp = useDerivedValue(() => -ty.value / (cardH * Y_THRESHOLD));

  const remaining = useMemo(() => cards.slice(index), [cards, index]);

  // ── Fold: cards lift and shrink toward the calendar, then hand back over.
  const beginFold = useCallback(() => {
    setFolding(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    fold.value = withTiming(1, { duration: FOLD_MS, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onDone)();
    });
  }, [fold, onDone]);

  // Right swipe: take this day and bring the next one forward. Once the last
  // card clears, the stack folds rather than sitting empty.
  const advance = useCallback(() => {
    const card = cards[index];
    if (!card) return;
    onAccept(card);

    tx.value = 0;
    ty.value = 0;

    const next = index + 1;
    setIndex(next);
    setReading(false);
    if (next >= cards.length) beginFold();
  }, [cards, index, onAccept, beginFold, tx, ty]);

  // Up swipe: take everything still in the deck, in one gesture.
  const acceptAll = useCallback(() => {
    for (const card of cards.slice(index)) onAccept(card);
    // Deliberately does NOT advance the index: the cards still on screen are
    // what the fold animates, so emptying the stack first would leave the
    // athlete watching nothing travel into the calendar.
    beginFold();
  }, [cards, index, onAccept, beginFold]);

  const buzz = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const skipAll = useCallback(() => {
    if (folding) return;
    onSkipAll(cards.slice(index));
    beginFold();
  }, [folding, cards, index, onSkipAll, beginFold]);

  const pan = Gesture.Pan()
    .enabled(!folding && !reading && remaining.length > 0)
    .onChange((e) => {
      tx.value += e.changeX;
      ty.value += e.changeY;
    })
    .onEnd((e) => {
      const rightPast = tx.value > cardW * X_THRESHOLD || e.velocityX > VELOCITY_THRESHOLD;
      const upPast = -ty.value > cardH * Y_THRESHOLD || e.velocityY < -VELOCITY_THRESHOLD;
      // Whichever axis the athlete actually moved along decides the gesture, so
      // a diagonal flick can't register as both.
      const horizontal = Math.abs(tx.value) > Math.abs(ty.value);

      if (horizontal && rightPast) {
        runOnJS(buzz)();
        ty.value = withTiming(ty.value + e.velocityY * 0.06, { duration: FLY_MS });
        tx.value = withTiming(
          winW * 1.3,
          { duration: FLY_MS, easing: Easing.out(Easing.quad) },
          (done) => {
            if (done) runOnJS(advance)();
          },
        );
        return;
      }

      if (!horizontal && upPast) {
        runOnJS(buzz)();
        runOnJS(acceptAll)();
        return;
      }

      // Left, down, or not far enough: spring home. Velocity carries over so the
      // release feels continuous with the drag rather than restarting.
      tx.value = withSpring(0, { velocity: e.velocityX, damping: 18, stiffness: 190 });
      ty.value = withSpring(0, { velocity: e.velocityY, damping: 18, stiffness: 190 });
    });

  // Backdrop dims the calendar while the stack owns the screen, then clears.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fold.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }));

  const chromeStyle = useAnimatedStyle(() => ({
    // Chrome leaves first so the fold reads as the cards travelling, not the
    // whole screen sliding.
    opacity: interpolate(fold.value, [0, 0.35], [1, 0], Extrapolation.CLAMP),
  }));

  const topCardStyle = useAnimatedStyle(() => {
    // Rotation comes from how far the card has been dragged sideways, which is
    // what makes it feel hinged at the wrist rather than sliding flat.
    const rot = interpolate(tx.value, [-winW / 2, 0, winW / 2], [-8, 0, 8], Extrapolation.CLAMP);
    // The top card folds with the rest of the stack, so an up swipe sends
    // everything still on screen into the calendar together.
    const foldLift = interpolate(fold.value, [0, 1], [0, -winH * FOLD_LIFT], Extrapolation.CLAMP);
    const foldScale = interpolate(fold.value, [0, 1], [1, FOLD_SCALE], Extrapolation.CLAMP);
    return {
      opacity: interpolate(fold.value, [0, 0.8], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + foldLift },
        { rotate: `${rot}deg` },
        { scale: foldScale },
      ],
      zIndex: 10,
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="plan-card-stack">
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        pointerEvents={folding ? 'none' : 'auto'}
      />

      {/* The deck explains itself: cards, a date, and something to swipe. No
          banner, no counter, no instructions, just a way out. */}
      <Animated.View style={[styles.chrome, chromeStyle]} pointerEvents={folding ? 'none' : 'box-none'}>
        <Pressable
          onPress={skipAll}
          hitSlop={16}
          style={styles.dismiss}
          testID="plan-card-skip"
          accessibilityRole="button"
          accessibilityLabel="Dismiss the new plan preview"
        >
          <X size={22} color="#8A8677" strokeWidth={2.2} />
        </Pressable>
      </Animated.View>

      <View style={styles.stageWrap} pointerEvents="box-none">
        <View
          style={[styles.stage, { width: cardW, height: cardH, marginLeft: -fanShift }]}
          pointerEvents="box-none"
        >
          {remaining
            .slice(0, VISIBLE_DEPTH + 1)
            // Deepest first so the top card ends up last in the tree, above the rest.
            .map((card, i) => ({ card, depth: i }))
            .reverse()
            .map(({ card, depth }) =>
              depth === 0 ? (
                <GestureDetector key={card.date} gesture={pan}>
                  <DayCard
                    card={card}
                    colors={colors}
                    width={cardW}
                    height={cardH}
                    interactive={!folding}
                    swipeUp={swipeUp}
                    stackStyle={topCardStyle}
                    onFlipChange={setReading}
                    testID="plan-card-top"
                  />
                </GestureDetector>
              ) : (
                <BehindCard
                  key={card.date}
                  card={card}
                  colors={colors}
                  width={cardW}
                  height={cardH}
                  depth={depth}
                  fold={fold}
                  foldLift={winH * FOLD_LIFT}
                  fanPivot={fanPivot}
                />
              ),
            )}
        </View>
      </View>
    </View>
  );
}

/**
 * A card sitting behind the active one: turned, scaled back, offset down. Its
 * depth is a shared value so promotion to the front springs rather than snaps
 * when the card above it flies away.
 */
function BehindCard({
  card,
  colors,
  width,
  height,
  depth,
  fold,
  foldLift,
  fanPivot,
}: {
  card: PlanDayCard;
  colors: Palette;
  width: number;
  height: number;
  depth: number;
  fold: SharedValue<number>;
  /** Pixels travelled upward during the fold, shared with the top card. */
  foldLift: number;
  /** Half the card height: the pivot sits on the card's own bottom edge. */
  fanPivot: number;
}) {
  const d = useSharedValue(depth);

  useEffect(() => {
    d.value = withSpring(depth, { damping: 16, stiffness: 160 });
  }, [depth, d]);

  const style = useAnimatedStyle(() => {
    // Everything left in the deck lifts and shrinks together during the fold,
    // travelling the same distance as the top card so the hand stays a hand.
    const lift = interpolate(fold.value, [0, 1], [0, -foldLift], Extrapolation.CLAMP);
    const foldScale = interpolate(fold.value, [0, 1], [1, FOLD_SCALE], Extrapolation.CLAMP);
    return {
      // Cards further back sit slightly quieter, which gives the fan depth
      // without needing a heavier shadow on every card.
      opacity: interpolate(d.value, [0, VISIBLE_DEPTH], [1, 0.55], Extrapolation.CLAMP) *
        interpolate(fold.value, [0, 0.8], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: lift },
        { scale: foldScale },
        // Rotate about a point far below the card: translate the pivot to the
        // origin, turn, translate back. This is the arc.
        { translateY: fanPivot },
        { rotate: `${d.value * FAN_STEP_DEG}deg` },
        { translateY: -fanPivot },
        { scale: 1 - d.value * 0.02 },
      ],
      zIndex: 10 - depth,
    };
  });

  return (
    <DayCard
      card={card}
      colors={colors}
      width={width}
      height={height}
      interactive={false}
      stackStyle={style}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(9,9,7,0.94)' },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 60, paddingHorizontal: space.xl, zIndex: 20 },
  dismiss: { alignSelf: 'flex-end' },

  stageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },
});
