// Stride design tokens — the single source of truth (PROMPT F.0).
//
// Aesthetic: a stadium timing board at night — dark, high-contrast, numeric,
// urgent. NOT a wellness app, NOT SaaS. Three tiers: primitive -> semantic ->
// component. No purple/indigo, no gradients on surfaces, no glassmorphism, no
// pill-everything. Corners 8 default / 12 max.

// ─── Tier 1: primitives ──────────────────────────────────────────────

export const primitive = {
  color: {
    graphite900: '#0E0F12',
    graphite800: '#16181D',
    graphite700: '#1E2127',
    graphite600: '#2A2E36',
    hairline: '#353A44',
    bone100: '#ECE7DC', // text primary
    bone300: '#B8B4AB',
    muted: '#8A8E97',
    signal: '#CDFF4F', // volt — primary actions, PRs, scan line
    flaw: '#FF5237', // detected faults ONLY
    improve: '#5BE5A0', // measured improvement ONLY
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const,
  radius: { sm: 4, md: 8 } as const, // sharp: 4 default, 8 max
  border: { hairline: 1 } as const,
  font: {
    display: 'Archivo', // headers/display — weights 600/700
    mono: 'SpaceMono', // metrics/numerals — angles, splits, cadence
    body: 'HankenGrotesk', // body — weights 400/500
  },
} as const;

// ─── Tier 2: semantic ────────────────────────────────────────────────

export const semantic = {
  surface: {
    base: primitive.color.graphite900,
    raised: primitive.color.graphite800,
    overlay: primitive.color.graphite700,
    sunken: primitive.color.graphite600,
  },
  border: primitive.color.hairline,
  text: {
    primary: primitive.color.bone100,
    secondary: primitive.color.bone300,
    muted: primitive.color.muted,
    onSignal: primitive.color.graphite900, // dark text on volt buttons
  },
  action: { primary: primitive.color.signal },
  status: {
    flaw: primitive.color.flaw,
    improve: primitive.color.improve,
    /** Personal-best / scan-line accent reuses the volt signal. */
    pr: primitive.color.signal,
  },
} as const;

// ─── Tier 3: typography scale ────────────────────────────────────────

export const typography = {
  display: { fontFamily: primitive.font.display, fontWeight: '700', fontSize: 34, lineHeight: 38 },
  title: { fontFamily: primitive.font.display, fontWeight: '600', fontSize: 22, lineHeight: 26 },
  body: { fontFamily: primitive.font.body, fontWeight: '400', fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: primitive.font.body, fontWeight: '500', fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: primitive.font.body, fontWeight: '400', fontSize: 12, lineHeight: 16 },
  /** Numerals: angles, splits, cadence — always mono. */
  metric: { fontFamily: primitive.font.mono, fontWeight: '400', fontSize: 28, lineHeight: 32 },
  metricSmall: { fontFamily: primitive.font.mono, fontWeight: '400', fontSize: 14, lineHeight: 18 },
} as const;

// ─── Tier 3: component spacing/radii aliases ─────────────────────────

export const spacing = primitive.space;
export const radius = primitive.radius;
export const borderWidth = primitive.border;

/** Flat root token object for convenience. */
export const tokens = { primitive, semantic, typography, spacing, radius, borderWidth } as const;

export type Tokens = typeof tokens;
export type SemanticColor = typeof semantic;
