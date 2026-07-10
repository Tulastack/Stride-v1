import React, { createContext, useContext, useMemo, useState } from 'react';
import { palettes, type Mode, type Palette } from '../theme';

interface ThemeContextValue {
  mode: Mode;
  colors: Palette;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

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
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
