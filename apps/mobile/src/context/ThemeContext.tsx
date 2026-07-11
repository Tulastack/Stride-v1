import React, { createContext, useContext, useMemo, useState } from 'react';
import { palettes, type Mode, type Palette } from '../theme';

interface ThemeContextValue {
  mode: Mode;
  colors: Palette;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
}

// Safe default so a screen rendered outside the provider (e.g. in isolation
// under a unit test, or during an early mount) falls back to the light palette
// instead of hard-crashing. The real app always mounts <ThemeProvider>.
const DEFAULT_THEME: ThemeContextValue = {
  mode: 'light',
  colors: palettes.light,
  setMode: () => {},
  toggleMode: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_THEME);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('light');

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    colors: palettes[mode],
    setMode,
    toggleMode: () => setMode((m) => (m === 'light' ? 'dark' : 'light')),
  }), [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
