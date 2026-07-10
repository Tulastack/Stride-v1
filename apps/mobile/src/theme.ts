// Stride v2 theme — light-first with gold accent, full dark mode support.
// Every screen reads colors via useTheme(), nothing hardcoded.

export const palettes = {
  light: {
    bg: '#F7F5EF',
    card: '#FFFFFF',
    cardAlt: '#F1EEE3',
    border: '#E4E0D2',
    text: '#1C1B17',
    muted: '#79766A',
    accent: '#CDA84E',
    accentText: '#1C1B17',
    error: '#C1432B',
    success: '#2E8F63',
  },
  dark: {
    bg: '#141310',
    card: '#1D1B16',
    cardAlt: '#252219',
    border: '#37342A',
    text: '#F3F0E4',
    muted: '#948F7D',
    accent: '#DEC178',
    accentText: '#141310',
    error: '#E2604A',
    success: '#5BC48F',
  },
} as const;

export type Palette = typeof palettes.light;
export type Mode = 'light' | 'dark';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, pill: 999 } as const;

export const type = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  h1: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.2 },
  h2: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.1 },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 1.1 },
  caption: { fontSize: 12, fontWeight: '400' as const },
  tiny: { fontSize: 10, fontWeight: '600' as const, letterSpacing: 0.5 },
} as const;

export const iconStroke = 1.75;
