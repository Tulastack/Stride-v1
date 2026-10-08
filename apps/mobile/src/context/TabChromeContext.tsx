import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const DOCK_HEIGHT = 68;
const TabChromeContext = createContext({ bottomSpace: 0, hidden: false, setImmersive: (_value: boolean) => {} });

export function TabChromeProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [immersive, setImmersive] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const hidden = immersive || keyboard;
  const value = useMemo(() => ({ hidden, bottomSpace: hidden ? 0 : DOCK_HEIGHT + Math.max(insets.bottom, 12) + 16, setImmersive }), [hidden, insets.bottom]);
  return <TabChromeContext.Provider value={value}>{children}</TabChromeContext.Provider>;
}

export function useTabChrome() { return useContext(TabChromeContext); }
