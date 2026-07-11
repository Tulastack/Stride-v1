import { create } from 'zustand';
import { NativeModules } from 'react-native';

/**
 * Resolve the API base URL. In dev we DERIVE the host from the Metro bundle URL
 * (the phone already connected to it), so it always matches the machine running
 * the dev server + API — no more stale hardcoded LAN IPs when DHCP changes it.
 * Falls back to the env var (e.g. a staging/prod URL) then localhost.
 */
function resolveApiBaseUrl(): string {
  try {
    const scriptURL: string | undefined = (NativeModules as { SourceCode?: { scriptURL?: string } })?.SourceCode?.scriptURL;
    const m = scriptURL?.match(/^https?:\/\/([^/:]+)/);
    if (m?.[1] && m[1] !== 'localhost' && m[1] !== '127.0.0.1') return `http://${m[1]}:3000`;
  } catch {
    /* not in a dev client (e.g. production build) — fall through */
  }
  return process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';
}

interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  event_specialty: '100m' | '200m' | '400m' | null;
  experience_level: 'beginner' | 'intermediate' | 'advanced' | null;
  personal_best_seconds: number | null;
}

interface StrideState {
  token: string | null;
  user: UserProfile | null;
  apiBaseUrl: string;
  consentGiven: boolean;
  isInjured: boolean;
  drillIntensityCap: 'moderate' | 'full' | null;
  setToken: (token: string | null) => void;
  setUser: (user: UserProfile | null) => void;
  logout: () => void;
  setConsentGiven: (v: boolean) => void;
  setIsInjured: (v: boolean) => void;
  setDrillIntensityCap: (v: 'moderate' | 'full' | null) => void;
}

export const useStrideStore = create<StrideState>((set) => ({
  token: null,
  user: null,
  // Auto-derived from the Metro host in dev (self-heals when the LAN IP changes);
  // env var / localhost otherwise.
  apiBaseUrl: resolveApiBaseUrl(),
  consentGiven: false,
  isInjured: false,
  drillIntensityCap: null,
  setToken: (token) => set({ token }),
  setUser: (user) => set({ user }),
  logout: () => set({ token: null, user: null }),
  setConsentGiven: (v) => set({ consentGiven: v }),
  setIsInjured: (v) => set({ isInjured: v }),
  setDrillIntensityCap: (v) => set({ drillIntensityCap: v }),
}));
