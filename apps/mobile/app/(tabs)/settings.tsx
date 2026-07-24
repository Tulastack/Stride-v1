import React, { useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet, SafeAreaView, ScrollView, Alert } from 'react-native';
import { Settings as SettingsIcon, Sun, Moon, LogOut, Trash2, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { supabase } from '../../src/lib/supabase';
import { space, radius, type as typo, iconStroke } from '../../src/theme';

export default function SettingsScreen() {
  const { colors, mode, toggleMode } = useTheme();
  const router = useRouter();
  const user = useStrideStore((s) => s.user);
  const logout = useStrideStore((s) => s.logout);
  const [notifications, setNotifications] = useState(true);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          // End the Supabase session too, or a refresh resurrects the login.
          await supabase?.auth.signOut().catch(() => {});
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account and all of your videos, analyses, and coaching history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await strideApi.deleteAccount();
              await supabase?.auth.signOut().catch(() => {});
              logout();
              router.replace('/(auth)/login');
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Could not delete your account. Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.h1, { color: colors.text }]}>Settings</Text>
          <SettingsIcon size={20} color={colors.accent} strokeWidth={iconStroke} />
        </View>

        {/* Account */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>ACCOUNT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
              <Text style={[styles.avatarText, { color: colors.accentText }]}>
                {user?.display_name?.[0]?.toUpperCase() || 'A'}
              </Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{user?.display_name || 'Athlete'}</Text>
              <Text style={[styles.rowSub, { color: colors.muted }]}>{user?.email || 'Not signed in'}</Text>
            </View>
          </View>
        </View>

        {/* Appearance */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>APPEARANCE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: colors.cardAlt }]}>
              {mode === 'light'
                ? <Sun size={16} color={colors.accent} strokeWidth={iconStroke} />
                : <Moon size={16} color={colors.accent} strokeWidth={iconStroke} />}
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Dark mode</Text>
              <Text style={[styles.rowSub, { color: colors.muted }]}>{mode === 'dark' ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              value={mode === 'dark'}
              onValueChange={toggleMode}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.card}
            />
          </View>
        </View>

        {/* Preferences */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>PREFERENCES</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Notifications</Text>
              <Text style={[styles.rowSub, { color: colors.muted }]}>Training reminders</Text>
            </View>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.card}
            />
          </View>
        </View>

        {/* Logout */}
        <Pressable style={[styles.logoutBtn, { borderColor: colors.error }]} onPress={handleLogout}>
          <LogOut size={16} color={colors.error} strokeWidth={iconStroke} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Log out</Text>
        </Pressable>

        {/* Delete account (App Store 5.1.1(v)) */}
        <Pressable style={[styles.deleteBtn, { backgroundColor: colors.error }]} onPress={handleDeleteAccount}>
          <Trash2 size={16} color="#FFFFFF" strokeWidth={iconStroke} />
          <Text style={styles.deleteText}>Delete Account</Text>
        </Pressable>

        <Text style={[styles.version, { color: colors.muted }]}>STRIDE v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxxl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xl },
  h1: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 1.1, marginBottom: space.sm, marginTop: space.lg },
  card: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontWeight: '600' },
  iconWrap: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  logoutBtn: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingVertical: space.md, marginTop: space.xl },
  logoutText: { fontSize: 15, fontWeight: '700' },
  deleteBtn: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingVertical: space.md, marginTop: space.md },
  deleteText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  version: { fontSize: 12, textAlign: 'center', marginTop: space.xl },
});
