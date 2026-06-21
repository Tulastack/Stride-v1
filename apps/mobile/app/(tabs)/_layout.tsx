import React from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Camera, BarChart2, LineChart, ClipboardList, User } from 'lucide-react-native';
import { semantic, borderWidth } from '../../src/ui/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: semantic.action.primary,
        tabBarInactiveTintColor: semantic.text.muted,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Upload',
          tabBarIcon: ({ color, size }) => <Camera color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="analysis"
        options={{
          href: null,
          title: 'Analyzer',
          tabBarIcon: ({ color, size }) => <BarChart2 color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ color, size }) => <LineChart color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: semantic.surface.raised,
    borderTopColor: semantic.border,
    borderTopWidth: borderWidth.hairline,
    height: 80,
    paddingBottom: 24,
    paddingTop: 12,
  },
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 4,
    letterSpacing: 0.5,
  },
});
