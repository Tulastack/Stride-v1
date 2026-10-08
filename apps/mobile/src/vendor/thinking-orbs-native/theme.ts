import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, useColorScheme } from 'react-native';
import type { OrbTheme } from './types';

export function useResolvedDark(theme: OrbTheme): boolean {
  const scheme = useColorScheme();
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return scheme !== 'light';
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** True while the app is foregrounded. The render loop stops otherwise. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state !== 'background'));
    return () => sub.remove();
  }, []);
  return active;
}

/** Seconds since an arbitrary origin, shared by every orb on screen. */
export function nowSeconds(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() / 1000 : Date.now() / 1000;
}
