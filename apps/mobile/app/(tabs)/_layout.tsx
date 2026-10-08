import React from 'react';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { TabChromeProvider } from '../../src/context/TabChromeContext';
import { StrideTabBar } from '../../src/ui/StrideTabBar';

export default function TabsLayout() {
  const { reduceMotion } = useTheme();
  return <TabChromeProvider>
    <Tabs tabBar={(props) => <StrideTabBar {...props} />} screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, animation: reduceMotion ? 'none' : 'fade' }}>
      <Tabs.Screen name="index" options={{ title: 'Capture', tabBarButtonTestID: 'tab-capture' }} />
      <Tabs.Screen name="analysis" options={{ href: null, title: 'Analysis' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarButtonTestID: 'tab-progress' }} />
      <Tabs.Screen name="coach" options={{ title: 'Coach', tabBarButtonTestID: 'tab-coach' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Plan', tabBarButtonTestID: 'tab-plan' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarButtonTestID: 'tab-settings' }} />
    </Tabs>
  </TabChromeProvider>;
}
