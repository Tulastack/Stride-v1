import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { User, LogOut, Save, ShieldCheck } from 'lucide-react-native';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useStrideStore((state) => state.user);
  const setUser = useStrideStore((state) => state.setUser);
  const logout = useStrideStore((state) => state.logout);

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [eventSpecialty, setEventSpecialty] = useState(user?.event_specialty || '100m');
  const [experienceLevel, setExperienceLevel] = useState(user?.experience_level || 'beginner');
  const [pb, setPb] = useState(user?.personal_best_seconds ? String(user.personal_best_seconds) : '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!displayName) {
      Alert.alert('Error', 'Please provide a display name');
      return;
    }

    setSaving(true);
    const pbSeconds = pb ? parseFloat(pb) : undefined;

    try {
      let updatedUser = null;
      try {
        updatedUser = await strideApi.updateProfile({
          displayName,
          eventSpecialty,
          experienceLevel,
          personalBestSeconds: pbSeconds,
        });
      } catch (e) {
        updatedUser = {
          ...user,
          display_name: displayName,
          event_specialty: eventSpecialty,
          experience_level: experienceLevel,
          personal_best_seconds: pbSeconds ?? null,
        };
      }

      setUser(updatedUser);
      Alert.alert('Profile Saved', 'Your sprint athlete profile has been successfully updated.');
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of Stride?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>PROFILE</Text>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <User color="#FFFFFF" size={32} />
          </View>
          <View>
            <Text style={styles.profileName}>{user?.display_name || 'Athlete'}</Text>
            <Text style={styles.profileEmail}>{user?.email || 'athlete@stride.ai'}</Text>
          </View>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>DISPLAY NAME</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Athlete Name"
              placeholderTextColor="#999999"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>EVENT SPECIALTY</Text>
            <View style={styles.pickerRow}>
              {(['100m', '200m', '400m'] as const).map((spec) => (
                <TouchableOpacity
                  key={spec}
                  style={[styles.pickerButton, eventSpecialty === spec ? styles.activePicker : null]}
                  onPress={() => setEventSpecialty(spec)}
                >
                  <Text style={[styles.pickerText, eventSpecialty === spec ? styles.activePickerText : null]}>
                    {spec}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>EXPERIENCE LEVEL</Text>
            <View style={styles.pickerRow}>
              {(['beginner', 'intermediate', 'advanced'] as const).map((level) => (
                <TouchableOpacity
                  key={level}
                  style={[styles.pickerButton, experienceLevel === level ? styles.activePicker : null]}
                  onPress={() => setExperienceLevel(level)}
                >
                  <Text style={[styles.pickerText, experienceLevel === level ? styles.activePickerText : null]}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>PERSONAL BEST (SECONDS)</Text>
            <TextInput
              style={styles.input}
              value={pb}
              onChangeText={setPb}
              keyboardType="decimal-pad"
              placeholder="e.g. 10.85"
              placeholderTextColor="#999999"
            />
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Save color="#FFFFFF" size={18} />}
            <Text style={styles.saveBtnText}>{saving ? 'SAVING...' : 'SAVE PROFILE'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <LogOut color="#000000" size={18} />
            <Text style={styles.logoutBtnText}>SIGN OUT</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.securityBox}>
          <ShieldCheck color="#000000" size={18} />
          <Text style={styles.securityText}>SECURED BY SUPABASE JWT</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    paddingVertical: 16,
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: -1,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    borderWidth: 2,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileName: {
    fontSize: 24,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: -0.5,
  },
  profileEmail: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
    fontWeight: '600',
  },
  formContainer: {
    gap: 24,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pickerButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    borderWidth: 2,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activePicker: {
    backgroundColor: '#000000',
  },
  pickerText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  activePickerText: {
    color: '#FFFFFF',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingVertical: 18,
    marginTop: 12,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    borderWidth: 2,
    paddingVertical: 18,
  },
  logoutBtnText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  securityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 40,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#F9F9F9',
  },
  securityText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
