import { useStrideStore } from '../store/useStrideStore';
import { getAccessToken } from '../lib/supabase';
import type { CaptureManifest } from './capture';

interface FetchOptions extends RequestInit {
  token?: string | null;
}

// Structured coach action chips — must match the server enum (no free-text chat, F.5).
export type CoachActionChip =
  | 'why_is_this_an_issue'
  | 'mark_understood'
  | 'show_drill'
  | 'ask_coach'
  | 'view_timeline';

const CHIP_LABELS: Record<CoachActionChip, string> = {
  why_is_this_an_issue: 'Why is this an issue?',
  mark_understood: 'Got it',
  show_drill: 'Show me the drill',
  ask_coach: 'Ask the coach',
  view_timeline: 'View my timeline',
};

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const state = useStrideStore.getState();
  // Prefer an explicit token, else a FRESH Supabase token (auto-refreshed),
  // else the stored token (demo/mock mode). This prevents stale-JWT 401s on
  // long-lived screens.
  const token = options.token ?? (await getAccessToken()) ?? state.token;
  const baseUrl = state.apiBaseUrl;

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    throw new Error(errorJson.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export interface OverlayData {
  fps: number;
  width: number;
  height: number;
  frames: { tMs: number; kp: number[][] }[];
}
const overlayCache = new Map<string, OverlayData>();

// ─── API Service Client ───────────────────────────────────────────

export const strideApi = {
  // --- Users ---
  getProfile: async (token?: string | null) => {
    return request<any>('/users/me', { method: 'GET', token });
  },

  updateProfile: async (profile: { displayName?: string; eventSpecialty?: string; experienceLevel?: string; personalBestSeconds?: number }) => {
    return request<any>('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(profile),
    });
  },

  // --- Analyses & Video ---
  listAnalyses: async () => {
    return request<any[]>('/videos');
  },

  getAnalysis: async (analysisId: string) => {
    return request<any>(`/videos/${analysisId}`);
  },

  // Per-frame keypoint overlay for the results-screen skeleton player (cached
  // per analysis so multiple cards don't refetch).
  getOverlay: async (analysisId: string) => {
    const cached = overlayCache.get(analysisId);
    if (cached) return cached;
    const data = await request<OverlayData>(`/videos/${analysisId}/overlay`);
    overlayCache.set(analysisId, data);
    return data;
  },

  // Token-in-query URL the native video player can load directly (no headers).
  videoFileUrl: async (analysisId: string): Promise<string> => {
    const state = useStrideStore.getState();
    const token = (await getAccessToken()) ?? state.token ?? '';
    return `${state.apiBaseUrl}/videos/${analysisId}/file?token=${encodeURIComponent(token)}`;
  },

  requestUploadUrls: async (numParts: number) => {
    return request<{ analysisId: string; uploadId: string; parts: { partNumber: number; url: string }[] }>('/videos/upload-url', {
      method: 'POST',
      body: JSON.stringify({ numParts }),
    });
  },

  finalizeUpload: async (
    analysisId: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
    captureManifest?: CaptureManifest
  ) => {
    return request<any>('/videos/finalize', {
      method: 'POST',
      body: JSON.stringify({ analysisId, uploadId, parts, captureManifest }),
    });
  },

  // --- Agent / Chat REMOVED (PRD v2.2 F.5) ---
  // No createConversation/sendMessage. Coaching is structured-only: see the
  // Coach Briefing screen and the metrics/history endpoints below.

  // --- Calendar ---
  listEvents: async (from: string, to: string) => {
    return request<any[]>(`/calendar/events?from=${from}&to=${to}`);
  },

  createEvent: async (event: { title: string; eventType: string; scheduledDate: string; details?: any }) => {
    return request<any>('/calendar/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },

  updateEvent: async (eventId: string, update: { status?: string; completionNote?: string }) => {
    return request<any>(`/calendar/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
  },

  // --- Consent & Liability ---
  giveConsent: async (params: {
    consent_version: number;
    date_of_birth?: string;
    parental_consent?: boolean;
  }): Promise<any> => {
    return request<any>('/consent', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  updateInjuryStatus: async (is_injured: boolean): Promise<any> => {
    return request<any>('/users/me/injury', {
      method: 'PATCH',
      body: JSON.stringify({ is_injured }),
    });
  },

  // --- Coach Sessions ---
  // Server contract: mounted at /coach-sessions; bodies are snake_case; structured
  // action chips flow through POST /:id/message (no free-text chat — F.5).
  createCoachSession: async (sessionType: 'analysis_workflow' | 'free_coach', analysisId?: string) => {
    return request<any>('/coach-sessions', {
      method: 'POST',
      body: JSON.stringify({ session_type: sessionType, analysis_id: analysisId }),
    });
  },

  listCoachSessions: async () => {
    return request<any[]>('/coach-sessions');
  },

  getCoachSession: async (sessionId: string) => {
    return request<any>(`/coach-sessions/${sessionId}`);
  },

  // The structured action chips the server understands.
  sendChipAction: async (sessionId: string, actionChip: CoachActionChip, content?: string) => {
    return request<any>(`/coach-sessions/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ content: content ?? CHIP_LABELS[actionChip], action_chip: actionChip }),
    });
  },

  // Free-form question to the grounded Groq coach (free_coach sessions).
  askCoach: async (sessionId: string, content: string) => {
    return request<{ role: string; content: string }>(`/coach-sessions/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  // Sealing a workflow session is the 'mark_understood' chip.
  sealCoachSession: async (sessionId: string) => {
    return request<any>(`/coach-sessions/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ content: CHIP_LABELS.mark_understood, action_chip: 'mark_understood' }),
    });
  },

  // --- Metrics ---
  getMetrics: async (days: number = 30) => {
    return request<Record<string, any[]>>(`/users/me/metrics?days=${days}`);
  },

  getMetricsTrend: async (metricKey: string, weeks: number = 4) => {
    return request<any[]>(`/users/me/metrics/${metricKey}/trend?weeks=${weeks}`);
  },

  // --- Drill Suggestions ---
  getSuggestions: async (analysisId: string) => {
    return request<any[]>(`/analyses/${analysisId}/suggestions`);
  },

  approveSuggestion: async (id: string) => {
    return request<any>(`/suggestions/${id}/approve`, { method: 'POST' });
  },

  skipSuggestion: async (id: string) => {
    return request<any>(`/suggestions/${id}/skip`, { method: 'POST' });
  },
};
