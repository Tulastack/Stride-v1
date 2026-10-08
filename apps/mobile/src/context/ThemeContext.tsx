import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, type Mode, type Palette, type Appearance } from '../theme';

interface ThemeContextValue {
  mode: Mode;
  colors: Palette;
  appearance: Appearance;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
  setAppearance: (appearance: Appearance) => void;
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light', colors: palettes.light, appearance: 'system',
  setMode: () => {}, toggleMode: () => {}, setAppearance: () => {},
  reduceMotion: false, setReduceMotion: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemMode = useColorScheme();
  const [appearance, updateAppearance] = useState<Appearance>('system');
  const [reduceMotion, updateReduceMotion] = useState(false);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const mode: Mode = appearance === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : appearance;

  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet(['stride.appearance', 'stride.reduceMotion']).then(([savedAppearance, savedMotion]) => {
      if (!active) return;
      if (['light', 'dark', 'system'].includes(savedAppearance[1] ?? '')) updateAppearance(savedAppearance[1] as Appearance);
      updateReduceMotion(savedMotion[1] === 'true');
    }).catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setSystemReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const setAppearance = (next: Appearance) => {
      updateAppearance(next);
      AsyncStorage.setItem('stride.appearance', next).catch(() => {});
    };
    return {
      mode, colors: palettes[mode], appearance, setAppearance,
      setMode: setAppearance,
      toggleMode: () => setAppearance(mode === 'light' ? 'dark' : 'light'),
      reduceMotion: reduceMotion || systemReduceMotion,
      setReduceMotion: (next) => {
        updateReduceMotion(next);
        AsyncStorage.setItem('stride.reduceMotion', String(next)).catch(() => {});
      },
    };
  }, [mode, appearance, reduceMotion, systemReduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
