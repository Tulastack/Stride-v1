import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, type ViewProps, type TextProps, type StyleProp, type ViewStyle, type TextStyle, type TextInputProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, ChevronLeft } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { space, radius, type as typo, iconStroke } from '../theme';
import { StrideLogo } from './StrideLogo';
import { useTabChrome } from '../context/TabChromeContext';

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const { bottomSpace } = useTabChrome();
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.bg }}>{scroll ? <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.page, style, { paddingBottom: Math.max(space.xxxl, bottomSpace) }]}>{children}</ScrollView> : <View style={[styles.flex, style, { paddingBottom: bottomSpace }]}>{children}</View>}</SafeAreaView>;
}

export function ScreenHeader({ eyebrow, title, subtitle, right, onBack, logo }: { eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void; logo?: boolean }) {
  const { colors } = useTheme();
  return <View style={styles.header}>{onBack ? <IconButton label="Go back" onPress={onBack}><ChevronLeft size={22} color={colors.text} /></IconButton> : null}<View style={styles.flex}>{logo ? <StrideLogo height={26} style={{ marginBottom: 10 }} /> : eyebrow ? <Text style={[typo.label, { color: colors.goldInk, marginBottom: 7 }]}>{eyebrow.toUpperCase()}</Text> : null}<Text accessibilityRole="header" style={[typo.h1, { color: colors.text }]}>{title}</Text>{subtitle ? <Text style={[typo.caption, { color: colors.muted, marginTop: 6 }]}>{subtitle}</Text> : null}</View>{right}</View>;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, testID, accessibilityLabel, style }: { label: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'quiet'; disabled?: boolean; loading?: boolean; testID?: string; accessibilityLabel?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const foreground = variant === 'primary' ? colors.accentText : colors.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }} testID={testID} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.cardAlt : colors.transparent, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }, style]}>{loading ? <ActivityIndicator color={foreground} /> : <><Text style={[typo.bodyMedium, { color: foreground, flexShrink: 1 }]}>{label}</Text>{variant === 'primary' ? <ArrowRight color={foreground} size={17} strokeWidth={iconStroke} /> : null}</>}</Pressable>;
}

export function IconButton({ children, label, onPress, disabled, testID }: { children: React.ReactNode; label: string; onPress?: () => void; disabled?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>{children}</Pressable>;
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 8 }}><Text style={[typo.caption, { color: colors.muted }]}>{label}</Text><TextInput {...props} accessibilityLabel={props.accessibilityLabel ?? label} placeholderTextColor={colors.muted} onFocus={(event) => { setFocused(true); props.onFocus?.(event); }} onBlur={(event) => { setFocused(false); props.onBlur?.(event); }} style={[styles.field, { color: colors.text, backgroundColor: colors.card, borderColor: focused ? colors.focus : colors.border }, style]} /></View>;
}

const SheetScrollContext = React.createContext<SharedValue<number> | null>(null);

function releaseSheet(translateY: SharedValue<number>, onClose: () => void, reduceMotion: boolean, translationY: number, velocityY: number, success: boolean) {
  'worklet';
  const dismiss = success && (translationY > 90 || velocityY > 900);
  if (dismiss) {
    translateY.value = withTiming(640, { duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
    return;
  }
  translateY.value = withTiming(0, { duration: reduceMotion ? 0 : 180 });
}

export function SheetScroll({ horizontal, onScroll, bounces, overScrollMode, ...rest }: React.ComponentProps<typeof ScrollView>) {
  const scrollY = useContext(SheetScrollContext);
  return <ScrollView {...rest} horizontal={horizontal} bounces={horizontal ? bounces : false} overScrollMode={horizontal ? overScrollMode : 'never'} scrollEventThrottle={16} onScroll={(event) => { if (!horizontal && scrollY) scrollY.value = event.nativeEvent.contentOffset.y; onScroll?.(event); }} />;
}

export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const presented = useRef(false);
  useLayoutEffect(() => {
    if (visible && !presented.current && !reduceMotion) translateY.value = 640;
    presented.current = visible;
  }, [visible, reduceMotion, translateY]);
  const gestures = useMemo(() => {
    const chrome = Gesture.Pan()
      .activeOffsetY(8)
      .onUpdate((event) => { translateY.value = Math.max(0, event.translationY); })
      .onEnd((event, success) => { releaseSheet(translateY, onClose, reduceMotion, event.translationY, event.velocityY, success); });
    const body = Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((event) => {
        const touch = event.allTouches[0];
        originX.value = touch?.absoluteX ?? 0;
        originY.value = touch?.absoluteY ?? 0;
      })
      .onTouchesMove((event, manager) => {
        const touch = event.allTouches[0];
        if (!touch) return;
        const dx = touch.absoluteX - originX.value;
        const dy = touch.absoluteY - originY.value;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) { manager.fail(); return; }
        if (scrollY.value > 2 || dy < -8) { manager.fail(); return; }
        if (dy > 14) manager.activate();
      })
      .onUpdate((event) => { translateY.value = Math.max(0, event.translationY); })
      .onEnd((event, success) => { releaseSheet(translateY, onClose, reduceMotion, event.translationY, event.velocityY, success); });
    return { chrome, body };
  }, [onClose, originX, originY, reduceMotion, scrollY, translateY]);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  useEffect(() => {
    scrollY.value = 0;
    if (!visible) {
      translateY.value = 0;
      return;
    }
    translateY.value = withTiming(0, { duration: reduceMotion ? 0 : 280, easing: Easing.out(Easing.cubic) });
  }, [visible, reduceMotion, scrollY, translateY]);

  return (
    <SheetScrollContext.Provider value={scrollY}>
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.scrim, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss sheet" />
          <Animated.View accessibilityViewIsModal testID={testID} style={[styles.sheet, sheetStyle, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, space.xl) }]}>
            <GestureDetector gesture={gestures.chrome}>
              <View>
                <View accessibilityLabel="Drag down to close" style={styles.grabber}><View style={[styles.handle, { backgroundColor: colors.border }]} /></View>
                <View style={styles.header}>
                  <Text accessibilityRole="header" style={[typo.h2, styles.flex, { color: colors.text }]}>{title}</Text>
                </View>
              </View>
            </GestureDetector>
            <GestureDetector gesture={gestures.body}>
              <View style={{ gap: space.lg, flexShrink: 1 }}>{children}</View>
            </GestureDetector>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SheetScrollContext.Provider>
  );
}

export function SegmentedControl<Value extends string>({ value, onChange, options, label }: { value: Value; onChange: (value: Value) => void; options: { value: Value; label: string; accessibilityLabel?: string; testID?: string }[]; label?: string }) {
  const { colors } = useTheme();
  return <View accessibilityLabel={label} style={[styles.segments, { backgroundColor: colors.cardAlt }]}>{options.map((option) => <Pressable key={option.value} testID={option.testID} accessibilityRole="button" accessibilityLabel={option.accessibilityLabel ?? option.label} accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} style={[styles.segment, { backgroundColor: value === option.value ? colors.card : colors.transparent }]}><Text style={[typo.caption, { fontWeight: '500', color: value === option.value ? colors.text : colors.muted }]}>{option.label}</Text></Pressable>)}</View>;
}

export function Notice({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'error' }) {
  const { colors } = useTheme();
  return <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[styles.notice, { backgroundColor: tone === 'error' ? colors.cardAlt : colors.sage }]}><Text style={[typo.caption, { color: tone === 'error' ? colors.error : colors.sageInk }]}>{children}</Text></View>;
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.header, { marginTop: 8 }]}><Text accessibilityRole="header" style={[typo.h2, styles.flex, { color: colors.text }]}>{children}</Text>{aside}</View>;
}

export function TrackScene({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  return <View accessibilityLabel="Illustration of running lanes, not measurement data" style={{ height: compact ? 120 : 210, overflow: 'hidden' }}><Svg width="100%" height="100%" viewBox="0 0 360 210"><Defs><LinearGradient id="lane" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.accent} stopOpacity="0.12" /><Stop offset="1" stopColor={colors.accent} stopOpacity="0.95" /></LinearGradient></Defs>{[0, 1, 2, 3, 4].map((lane) => <Path key={lane} d={`M ${-180 + lane * 42} 220 C ${25 + lane * 24} 190, ${75 + lane * 28} 10, ${340 + lane * 32} -15`} stroke="url(#lane)" strokeWidth={lane === 2 ? 2 : 1} fill="none" />)}<Line x1="230" y1="35" x2="270" y2="85" stroke={colors.wellBorder} /><Circle cx="240" cy="62" r="6" fill={colors.accent} /><Circle cx="240" cy="62" r="15" stroke={colors.accent} strokeOpacity="0.25" fill="none" /></Svg></View>;
}

export function Surface({ level = 'base', style, ...rest }: ViewProps & { level?: 'base' | 'raised' | 'overlay' | 'sunken' }) {
  const { colors } = useTheme();
  return <View {...rest} style={[{ backgroundColor: level === 'base' ? colors.bg : level === 'raised' ? colors.card : colors.cardAlt }, style]} />;
}
export function Card({ style, ...rest }: ViewProps & { level?: 'base' | 'raised' | 'overlay' | 'sunken' }) {
  return <Surface level="raised" {...rest} style={[{ padding: space.lg, borderRadius: radius.md }, style]} />;
}
export function MetricReadout({ value, unit, muted, style, testID }: { value: string | number; unit?: string; muted?: boolean; style?: StyleProp<TextStyle>; testID?: string }) {
  const { colors } = useTheme();
  return <Text testID={testID} style={[typo.numeric, { color: muted ? colors.muted : colors.text }, style]}>{value}{unit ? <Text style={[typo.caption, { color: colors.muted }]}>{` ${unit}`}</Text> : null}</Text>;
}
export function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  const { colors } = useTheme();
  return <View style={{ gap: 4 }}><Text style={[typo.caption, { color: colors.muted }]}>{label}</Text><MetricReadout value={value} unit={unit} /></View>;
}
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, width: '100%' }, style]} />;
}
export function Tag({ label, tone = 'neutral', testID }: { label: string; tone?: 'neutral' | 'flaw' | 'improve' | 'signal'; testID?: string }) {
  const { colors } = useTheme();
  return <Text testID={testID} style={[typo.caption, { color: tone === 'flaw' ? colors.error : tone === 'improve' ? colors.success : tone === 'signal' ? colors.goldInk : colors.muted }]}>{label}</Text>;
}
export function Title({ style, ...rest }: TextProps) { const { colors } = useTheme(); return <Text {...rest} style={[typo.h2, { color: colors.text }, style]} />; }
export function Display({ style, ...rest }: TextProps) { const { colors } = useTheme(); return <Text {...rest} style={[typo.display, { color: colors.text }, style]} />; }
export function Body({ muted, style, ...rest }: TextProps & { muted?: boolean }) { const { colors } = useTheme(); return <Text {...rest} style={[typo.body, { color: muted ? colors.muted : colors.text }, style]} />; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { padding: space.xl, paddingBottom: space.xxxl, gap: space.xl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  button: { minHeight: 52, borderRadius: radius.sm, paddingVertical: 14, paddingHorizontal: space.lg, flexDirection: 'row', gap: space.md, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  field: { minHeight: 52, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  scrim: { flex: 1, justifyContent: 'flex-end' }, sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.xl, paddingBottom: space.xxxl, gap: space.lg, maxHeight: '90%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  grabber: { alignItems: 'center', justifyContent: 'center', minHeight: 28, paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: radius.pill },
  segments: { flexDirection: 'row', borderRadius: radius.sm, padding: 4 }, segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', padding: 6 },
  notice: { padding: space.lg, borderRadius: radius.sm },
});
