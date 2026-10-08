import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { palettes, type as typo } from '../theme';
import { ThinkingOrb, type OrbState } from '../vendor/thinking-orbs-native';

const stage = palettes.dark;
const HERO = 176;
const DOCKED = 40;
const REASONING: OrbState[] = ['searching', 'weaving', 'solving', 'composing'];

export type CoachPresencePhase = 'idle' | 'reasoning' | 'docked';

export function CoachPresence({
  phase,
  reduceMotion,
  status,
  suggestions,
  onSuggest,
  children,
}: {
  phase: CoachPresencePhase;
  reduceMotion: boolean;
  status?: string;
  suggestions?: { title: string; prompt: string }[];
  onSuggest?: (prompt: string) => void;
  children?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [hostWidth, setHostWidth] = useState(width);
  const [beat, setBeat] = useState(0);
  const progress = useSharedValue(phase === 'docked' ? 1 : 0);
  const contentWidth = hostWidth || width;

  useEffect(() => {
    const next = phase === 'docked' ? 1 : 0;
    progress.value = reduceMotion ? next : withTiming(next, {
      duration: phase === 'docked' ? 1200 : 480,
      easing: phase === 'docked' ? Easing.inOut(Easing.cubic) : Easing.out(Easing.cubic),
    });
  }, [phase, progress, reduceMotion]);

  useEffect(() => {
    if (phase === 'docked' || reduceMotion) return;
    const id = setInterval(() => setBeat((value) => value + 1), 1500);
    return () => clearInterval(id);
  }, [phase, reduceMotion]);

  const orbState: OrbState = phase === 'reasoning' ? REASONING[beat % REASONING.length] : 'breathing';
  const host = useAnimatedStyle(() => ({
    minHeight: interpolate(progress.value, [0, 1], [280, 48]),
  }));
  const orb = useAnimatedStyle(() => ({
    left: interpolate(progress.value, [0, 1], [(contentWidth - HERO) / 2, -(HERO - DOCKED) / 2]),
    top: interpolate(progress.value, [0, 1], [36, -(HERO - DOCKED) / 2]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, DOCKED / HERO]) }],
  }));
  const copy = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.42, 1], [0, 1]),
    marginTop: interpolate(progress.value, [0, 1], [230, -40]),
    paddingLeft: 56,
  }));

  return (
    <View style={{ flexGrow: phase === 'docked' ? 0 : 1, justifyContent: 'center' }} onLayout={(event) => setHostWidth(event.nativeEvent.layout.width)}>
      <Animated.View style={[{ position: 'relative' }, host]}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: HERO, height: HERO }, orb]}>
          <ThinkingOrb
            state={orbState}
            size={64}
            displaySize={HERO}
            theme="dark"
            speed={phase === 'docked' ? 0.65 : 1}
            paused={reduceMotion}
            accessibilityLabel={phase === 'reasoning' ? 'Coach thinking' : 'Coach'}
          />
        </Animated.View>
        {phase === 'reasoning' && status ? (
          <Text style={[typo.caption, { color: stage.wellMuted, textAlign: 'center', marginTop: 230 }]}>{status}</Text>
        ) : null}
      </Animated.View>
      {phase === 'idle' && suggestions?.length ? (
        <View style={{ gap: 4, paddingTop: 8 }}>
          {suggestions.map((item) => (
            <Pressable key={item.prompt} accessibilityRole="button" onPress={() => onSuggest?.(item.prompt)} style={{ paddingVertical: 10 }}>
              <Text style={[typo.bodyMedium, { color: stage.text }]}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {children ? <Animated.View style={copy}>{children}</Animated.View> : null}
    </View>
  );
}
