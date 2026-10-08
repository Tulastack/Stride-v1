export const palettes = {
  light: {
    bg: '#F7F5F0', card: '#FFFFFF', cardAlt: '#EEEAE1', border: '#DEDAD1',
    text: '#242520', muted: '#63665C', accent: '#C8A140', accentText: '#252115',
    goldInk: '#806118', champagne: '#F0E4C6', error: '#AE4436', success: '#386B53',
    well: '#18221F', wellText: '#F7F4E9', wellMuted: '#BCC4B9',
    wellBorder: '#39463D', overlay: 'rgba(17,22,20,0.52)',
    sage: '#DFE7DA', sageInk: '#41604B', blue: '#526D7D', plum: '#796778',
    track: '#E5DBBF', focus: '#806118', transparent: 'transparent',
    glass: 'rgba(247,245,240,0.82)', glassLens: 'rgba(200,161,64,0.18)', cameraShade: 'rgba(14,21,19,0.92)',
  },
  dark: {
    bg: '#131917', card: '#1E2622', cardAlt: '#28312B', border: '#38413A',
    text: '#F0F0E7', muted: '#A8B1A5', accent: '#D9BB70', accentText: '#252115',
    goldInk: '#E1C781', champagne: '#3B3424', error: '#F39786', success: '#A1C6AE',
    well: '#0E1513', wellText: '#F7F4E9', wellMuted: '#BCC4B9',
    wellBorder: '#35433A', overlay: 'rgba(4,9,7,0.72)',
    sage: '#2C3C30', sageInk: '#B2CDB6', blue: '#ACC1CE', plum: '#C3AEC1',
    track: '#494631', focus: '#E1C781', transparent: 'transparent',
    glass: 'rgba(30,38,34,0.86)', glassLens: 'rgba(217,187,112,0.16)', cameraShade: 'rgba(14,21,19,0.92)',
  },
} as const;

export type Palette = { [Key in keyof typeof palettes.light]: string };
export type Mode = 'light' | 'dark';
export type Appearance = Mode | 'system';
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 18, lg: 28, pill: 999 } as const;
export const density = { editorial: { gutter: 24, section: 32 }, instrument: { gutter: 16, section: 16 } } as const;
export const type = {
  display: { fontSize: 42, lineHeight: 46, fontWeight: '400' as const, letterSpacing: -1.7 },
  editorial: { fontSize: 32, lineHeight: 37, fontWeight: '400' as const, letterSpacing: -0.9 },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '500' as const, letterSpacing: -0.8 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '500' as const, letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 23, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  label: { fontSize: 10, lineHeight: 15, fontWeight: '600' as const, letterSpacing: 1.6 },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' as const },
  tiny: { fontSize: 10, lineHeight: 14, fontWeight: '500' as const, letterSpacing: 0.5 },
  numeric: { fontSize: 36, lineHeight: 42, fontWeight: '400' as const, letterSpacing: -1, fontVariant: ['tabular-nums'] as ['tabular-nums'] },
} as const;
export const motion = { fast: 160, standard: 240, reveal: 420, spring: { damping: 24, stiffness: 220, mass: 0.9 } } as const;
export const iconStroke = 1.6;
export const materials = { separator: 0.5, chartLine: 2, overlayLine: 1.8, minTarget: 44 } as const;

export function colorRoles(colors: Palette) {
  return {
    surface: { base: colors.bg, raised: colors.card, overlay: colors.cardAlt, sunken: colors.border },
    border: colors.border,
    text: { primary: colors.text, secondary: colors.muted, muted: colors.muted, onSignal: colors.accentText },
    action: { primary: colors.accent },
    status: { flaw: colors.error, improve: colors.success, pr: colors.goldInk },
  };
}
export const primitive = { color: palettes.light, space, radius, border: { hairline: materials.separator } };
export const semantic = colorRoles(palettes.light);
export const typography = { display: type.display, title: type.h2, body: type.body, bodyStrong: type.bodyMedium, caption: type.caption, metric: type.numeric, metricSmall: { ...type.bodyMedium, fontVariant: ['tabular-nums'] as ['tabular-nums'] } };
export const spacing = space;
export const borderWidth = primitive.border;
export const tokens = { primitive, semantic, typography, spacing, radius, borderWidth, palettes, motion, density };
export type Tokens = typeof tokens;
export type SemanticColor = ReturnType<typeof colorRoles>;
