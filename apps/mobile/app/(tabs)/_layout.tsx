import React from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, Platform } from 'react-native';
import { Camera, TrendingUp, MessageCircle, Calendar, Settings } from 'lucide-react-native';
import { useTheme } from '../../src/context/ThemeContext';
import { space, type as typo, iconStroke } from '../../src/theme';

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: space.sm,
          paddingBottom: Platform.OS === 'ios' ? space.xl : space.md,
          height: Platform.OS === 'ios' ? 84 : 64,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, marginTop: 4 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Upload',
          tabBarIcon: ({ color }) => <Camera color={color} size={21} strokeWidth={iconStroke} />,
        }}
      />
      <Tabs.Screen
        name="analysis"
        options={{
          href: null,
          title: 'Analysis',
          tabBarIcon: ({ color }) => <TrendingUp color={color} size={21} strokeWidth={iconStroke} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ color }) => <TrendingUp color={color} size={21} strokeWidth={iconStroke} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color }) => <MessageCircle color={color} size={21} strokeWidth={iconStroke} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color }) => <Calendar color={color} size={21} strokeWidth={iconStroke} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Settings color={color} size={21} strokeWidth={iconStroke} />,
        }}
      />
    </Tabs>
  );
}
