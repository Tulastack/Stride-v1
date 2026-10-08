import { create } from 'zustand';
import { NativeModules } from 'react-native';
import Constants from 'expo-constants';

/**
 * Port the API listens on. Taken from EXPO_PUBLIC_API_BASE_URL when that is set
 * so it stays configurable, and 3001 otherwise, which is what scripts/dev-up.sh
 * starts and what apps/api/.env sets. It used to be hard-coded to 3000 here
 * while the API ran on 3001, so every request the derived URL produced went to a
 * port with nothing on it and hung until the network stack gave up.
 */
function devApiPort(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (configured) {
    try {
      const port = new URL(configured).port;
      if (port) return port;
    } catch {
      /* not a parseable URL, fall through to the default */
    }
  }
  return '3001';
}

/**
 * The machine serving this bundle, which in dev is also the machine running the
 * API. Expo populates hostUri with the dev server's address; scriptURL is the
 * older route and stays as a fallback for dev clients that do not set hostUri.
 */
function devHost(): string | null {
  const fromConstants =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | null)?.debuggerHost ??
    null;
  const host = fromConstants?.split('/')[0]?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return host;

  try {
    const scriptURL: string | undefined = (
      NativeModules as { SourceCode?: { scriptURL?: string } }
    )?.SourceCode?.scriptURL;
    const m = scriptURL?.match(/^https?:\/\/([^/:]+)/);
    if (m?.[1] && m[1] !== 'localhost' && m[1] !== '127.0.0.1') return m[1];
  } catch {
    /* not in a dev client (e.g. a production build), fall through */
  }
  return null;
}

/**
 * Resolve the API base URL. In dev we DERIVE the host from the machine serving
 * the bundle, because that is the one thing guaranteed to be reachable: the
 * phone just downloaded a bundle from it. A baked EXPO_PUBLIC_API_BASE_URL goes
 * stale the moment DHCP hands the Mac a different address, and because
 * EXPO_PUBLIC_* is inlined at bundle time, the app keeps calling the old one
 * until someone re-bundles with --clear. That is the failure this exists to
 * remove, so in dev the derived host WINS over the env var.
 *
 * Outside dev the env var is the answer, and a release build with nothing
 * configured gets an empty string so request() can say so plainly.
 */
export function resolveApiBaseUrl(): string {
  if (__DEV__) {
    const host = devHost();
    if (host) return `http://${host}:${devApiPort()}`;
  }
  if (process.env.EXPO_PUBLIC_API_BASE_URL) return process.env.EXPO_PUBLIC_API_BASE_URL;
  // Never silently point a release build at localhost, leave it empty so
  // request() throws a self-explanatory "API URL not configured" error.
  return __DEV__ ? `http://localhost:${devApiPort()}` : '';
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
  /** True once the initial Supabase getSession() has resolved (success or failure). */
  authHydrated: boolean;
  consentGiven: boolean;
  isInjured: boolean;
  drillIntensityCap: 'moderate' | 'full' | null;
  setToken: (token: string | null) => void;
  setUser: (user: UserProfile | null) => void;
  setAuthHydrated: (v: boolean) => void;
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
  authHydrated: false,
  consentGiven: false,
  isInjured: false,
  drillIntensityCap: null,
  setToken: (token) => set({ token }),
  setUser: (user) => set({ user }),
  setAuthHydrated: (v) => set({ authHydrated: v }),
  logout: () => set({ token: null, user: null, consentGiven: false, isInjured: false, drillIntensityCap: null }),
  setConsentGiven: (v) => set({ consentGiven: v }),
  setIsInjured: (v) => set({ isInjured: v }),
  setDrillIntensityCap: (v) => set({ drillIntensityCap: v }),
}));
