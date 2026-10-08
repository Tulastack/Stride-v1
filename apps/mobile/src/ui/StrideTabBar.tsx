import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Camera, TrendingUp, MessageCircle, CalendarDays, Settings2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { DOCK_HEIGHT, useTabChrome } from '../context/TabChromeContext';
import { dockIndex, dockPosition, dockTouchPosition } from '../lib/tabDock';
import { iconStroke, motion, palettes, radius, type as typo } from '../theme';

const icons = { index: Camera, progress: TrendingUp, coach: MessageCircle, calendar: CalendarDays, settings: Settings2 };
type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

export function StrideTabBar({ state, descriptors, navigation }: TabBarProps) {
  const { colors, mode, reduceMotion } = useTheme();
  const { hidden } = useTabChrome();
  const insets = useSafeAreaInsets();
  const focused = state.routes[state.index]?.name;
  const ink = focused === 'coach' ? palettes.dark : colors;
  const dark = focused === 'coach' || mode === 'dark';
  const routes = useMemo(() => state.routes.filter((route) => route.name in icons), [state.routes]);
  const selectedIndex = Math.max(0, routes.findIndex((route) => route.name === (focused === 'analysis' ? 'progress' : focused)));
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const [opaque, setOpaque] = useState(true);
  const translation = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const origin = useRef(0);
  const lastPreview = useRef(selectedIndex);
  const rail = useRef<View>(null);
  const railLeft = useRef<number | null>(null);
  const slot = Math.max(0, width - 8) / routes.length;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then((value) => { if (active) setOpaque(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion) translation.setValue(selectedIndex * slot);
    else Animated.spring(translation, { toValue: selectedIndex * slot, ...motion.spring, useNativeDriver: true }).start();
  }, [selectedIndex, slot, reduceMotion, translation]);

  const select = useCallback((index: number) => {
    const route = routes[index];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented && route.key !== state.routes[state.index]?.key) {
      Haptics.selectionAsync().catch(() => {});
      navigation.navigate(route.name, route.params);
    }
  }, [routes, navigation, state.routes, state.index]);
  const finish = useCallback((position?: number) => {
    setPreview(null);
    if (reduceMotion) { translation.setValue(selectedIndex * slot); scale.setValue(1); }
    else Animated.parallel([
      Animated.spring(translation, { toValue: selectedIndex * slot, ...motion.spring, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, ...motion.spring, useNativeDriver: true }),
    ]).start();
    if (position !== undefined) select(dockIndex(position, routes.length));
  }, [reduceMotion, selectedIndex, slot, translation, scale, select, routes.length]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => slot > 0 && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: (_event, gesture) => {
      translation.stopAnimation();
      origin.current = railLeft.current === null ? selectedIndex : dockTouchPosition(gesture.x0, railLeft.current, width, routes.length);
      const initial = dockIndex(origin.current, routes.length);
      lastPreview.current = initial; setPreview(initial);
      translation.setValue(origin.current * slot);
      if (!reduceMotion) Animated.spring(scale, { toValue: 1.06, ...motion.spring, useNativeDriver: true }).start();
    },
    onPanResponderMove: (_event, gesture) => {
      const position = dockPosition(origin.current + gesture.dx / slot, routes.length);
      translation.setValue(position * slot);
      const next = dockIndex(position, routes.length);
      if (next !== lastPreview.current) {
        lastPreview.current = next; setPreview(next); Haptics.selectionAsync().catch(() => {});
      }
    },
    onPanResponderRelease: (_event, gesture) => finish(origin.current + gesture.dx / slot),
    onPanResponderTerminate: () => finish(),
    onPanResponderTerminationRequest: () => true,
  }), [slot, width, selectedIndex, reduceMotion, translation, scale, routes.length, finish]);

  if (hidden) return null;
  return <View pointerEvents="box-none" style={[styles.host, { bottom: Math.max(insets.bottom, 12), shadowColor: ink.well }]}>
    <View ref={rail} testID="stride-tab-dock" onLayout={(event) => { setWidth(event.nativeEvent.layout.width); rail.current?.measureInWindow((left) => { railLeft.current = left; }); }} {...pan.panHandlers} style={[styles.rail, { borderColor: ink.border, backgroundColor: opaque || Platform.OS !== 'ios' ? ink.card : ink.transparent }]}>
      {!opaque && Platform.OS === 'ios' ? <><BlurView testID="tab-glass-material" pointerEvents="none" intensity={80} tint={dark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'} style={StyleSheet.absoluteFill} /><View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: ink.glass }]} /></> : null}
      {slot > 0 ? <Animated.View pointerEvents="none" testID="tab-drag-lens" style={[styles.lens, { width: slot, borderColor: ink.border, backgroundColor: opaque ? ink.champagne : ink.glassLens, transform: [{ translateX: translation }, { scale }] }]} /> : null}
      {routes.map((route, index) => {
        const active = (preview ?? selectedIndex) === index;
        const options = descriptors[route.key].options;
        const Icon = icons[route.name as keyof typeof icons];
        const label = options.title ?? route.name;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityHint="Tap to open. Drag across the dock to switch tabs." accessibilityState={{ selected: index === selectedIndex }} testID={options.tabBarButtonTestID} onPress={() => select(index)} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })} style={styles.tab}>
          <Icon size={21} strokeWidth={active ? 1.9 : iconStroke} color={active ? ink.goldInk : ink.muted} />
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.3} style={[typo.tiny, { letterSpacing: 0, color: active ? ink.text : ink.muted }]}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, alignItems: 'center', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  rail: { height: DOCK_HEIGHT, width: '100%', maxWidth: 500, flexDirection: 'row', padding: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, overflow: 'hidden' },
  lens: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4 },
});
