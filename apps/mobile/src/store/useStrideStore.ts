import { create } from 'zustand';

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
  // Fallback to localhost for simulator, can be configured to point to ALB
  apiBaseUrl: 'http://localhost:3000',
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
