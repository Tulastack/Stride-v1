// Primitive component kit (PROMPT F.0). Consumes ONLY design tokens.
// Flat surfaces, 1px hairline borders, no blur, no gradients. One dominant
// element per screen; everything else is quiet.

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewProps,
  type TextProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { semantic, spacing, radius, borderWidth, typography } from './theme';

// ─── Surface ─────────────────────────────────────────────────────────

type SurfaceLevel = 'base' | 'raised' | 'overlay' | 'sunken';
export function Surface({
  level = 'base',
  style,
  ...rest
}: ViewProps & { level?: SurfaceLevel }) {
  return <View style={[{ backgroundColor: semantic.surface[level] }, style]} {...rest} />;
}

// ─── Card (flat + 1px hairline border, no blur) ──────────────────────

export function Card({
  style,
  level = 'raised',
  ...rest
}: ViewProps & { level?: SurfaceLevel }) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: semantic.surface[level] },
        style,
      ]}
      {...rest}
    />
  );
}

// ─── Button (primary = signal on graphite; secondary = hairline outline) ─

type ButtonVariant = 'primary' | 'secondary';
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  testID,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          { color: isPrimary ? semantic.text.onSignal : semantic.text.primary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── MetricReadout (mono numerals) ───────────────────────────────────

export function MetricReadout({
  value,
  unit,
  muted,
  style,
  testID,
}: {
  value: string | number;
  unit?: string;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  return (
    <Text
      testID={testID}
      style={[
        typography.metric as TextStyle,
        { color: muted ? semantic.text.muted : semantic.text.primary },
        style,
      ]}
    >
      {value}
      {unit ? <Text style={styles.unit}>{` ${unit}`}</Text> : null}
    </Text>
  );
}

// ─── Stat (label + value pair) ───────────────────────────────────────

export function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[typography.caption as TextStyle, { color: semantic.text.muted }]}>{label}</Text>
      <MetricReadout value={value} unit={unit} style={styles.statValue} />
    </View>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

// ─── Tag ─────────────────────────────────────────────────────────────

type TagTone = 'neutral' | 'flaw' | 'improve' | 'signal';
export function Tag({ label, tone = 'neutral', testID }: { label: string; tone?: TagTone; testID?: string }) {
  const toneColor =
    tone === 'flaw'
      ? semantic.status.flaw
      : tone === 'improve'
        ? semantic.status.improve
        : tone === 'signal'
          ? semantic.action.primary
          : semantic.text.muted;
  return (
    <View testID={testID} style={[styles.tag, { borderColor: toneColor }]}>
      <Text style={[typography.caption as TextStyle, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

// ─── Text helpers ────────────────────────────────────────────────────

export function Title({ style, ...rest }: TextProps) {
  return <Text style={[typography.title as TextStyle, { color: semantic.text.primary }, style]} {...rest} />;
}
export function Display({ style, ...rest }: TextProps) {
  return <Text style={[typography.display as TextStyle, { color: semantic.text.primary }, style]} {...rest} />;
}
export function Body({ muted, style, ...rest }: TextProps & { muted?: boolean }) {
  return (
    <Text
      style={[typography.body as TextStyle, { color: muted ? semantic.text.muted : semantic.text.primary }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
    padding: spacing.lg,
  },
  button: {
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: semantic.action.primary },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: borderWidth.hairline,
    borderColor: semantic.border,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { ...(typography.bodyStrong as TextStyle) },
  unit: { ...(typography.metricSmall as TextStyle), color: semantic.text.muted },
  stat: { gap: spacing.xs },
  statValue: { fontSize: 20, lineHeight: 24 },
  divider: { height: borderWidth.hairline, backgroundColor: semantic.border, width: '100%' },
  tag: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: borderWidth.hairline,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
});
