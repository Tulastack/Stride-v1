// Stride v2 theme — light-first with gold accent, full dark mode support.
// Every screen reads colors via useTheme(), nothing hardcoded.

export const palettes = {
  light: {
    bg: '#F7F5EF',
    card: '#FFFFFF',
    cardAlt: '#F1EEE3',
    border: '#D9D3C0',   // stronger rules — surfaces read as drawn, not floating
    text: '#191813',
    muted: '#6B6859',    // darker muted: secondary text stays legible outdoors
    accent: '#C8A140',
    accentText: '#191813',
    error: '#C1432B',
    success: '#2E8F63',
  },
  dark: {
    bg: '#141310',
    card: '#1D1B16',
    cardAlt: '#252219',
    border: '#423D2E',
    text: '#F3F0E4',
    muted: '#A29D89',
    accent: '#DEC178',
    accentText: '#141310',
    error: '#E2604A',
    success: '#5BC48F',
  },
} as const;

// Structural palette type: every mode shares the same keys mapping to color
// strings. Using `string` (not the `as const` hex literals) lets both the light
// and dark palettes satisfy `Palette`, so `palettes[mode]` is assignable to it.
export type Palette = { [K in keyof typeof palettes.light]: string };
export type Mode = 'light' | 'dark';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
// Sharp corners are part of the identity: 4/6, never soft 12+ cards.
export const radius = { sm: 4, md: 6, pill: 999 } as const;

export const type = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.8 },
  h1: { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 1.2 },
  caption: { fontSize: 12, fontWeight: '400' as const },
  tiny: { fontSize: 10, fontWeight: '600' as const, letterSpacing: 0.5 },
} as const;

export const iconStroke = 1.75;
