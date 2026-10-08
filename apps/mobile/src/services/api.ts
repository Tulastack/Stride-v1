import { useStrideStore } from '../store/useStrideStore';
import { getAccessToken } from '../lib/supabase';
import type { CaptureManifest } from './capture';

interface FetchOptions extends RequestInit {
  token?: string | null;
  /** Milliseconds before the request is aborted. See REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * How long to wait on a JSON call before giving up.
 *
 * Expo SDK 57 replaced the global fetch with its own native implementation
 * (expo/src/winter/runtime.native.ts installs it unless EXPO_PUBLIC_USE_RN_FETCH
 * is set), and that one carries a URLSession timeout that React Native's
 * XHR-backed fetch did not. An unreachable host therefore stopped failing fast
 * and started sitting for the best part of a minute before surfacing
 * "UnexpectedException: The request timed out", with no clue which host it had
 * been trying. Ten seconds is far longer than any of these calls needs on a LAN
 * and short enough that a wrong address is obvious immediately.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The coach is a different kind of wait. It runs a tool-calling loop against an
 * LLM (search the knowledge base, read the athlete's metrics, then answer), so
 * tens of seconds is a normal success, not a fault. Holding it to the same
 * deadline as a DB read would cancel good answers.
 */
const COACH_TIMEOUT_MS = 90_000;

// Structured coach action chips, must match the server enum (no free-text chat, F.5).
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
  const baseUrl = state.apiBaseUrl;
  if (!baseUrl) throw new Error('API URL not configured. Set EXPO_PUBLIC_API_BASE_URL.');

  const url = `${baseUrl}${path}`;
  const doFetch = async (token?: string | null) => {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // A caller's own signal still wins; this only adds a deadline when there
    // isn't one, so nothing can hang indefinitely on a dead host.
    const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    return fetch(url, { ...options, headers, signal });
  };

  // Fast path: the stored token is kept fresh by Supabase autoRefresh +
  // onAuthStateChange (see app/_layout.tsx), so we skip a per-request getSession().
  let token = options.token ?? state.token;
  let response: Response;
  try {
    response = await doFetch(token);
  } catch (netErr: any) {
    // Whatever the transport called it, the athlete (and whoever is debugging)
    // needs the address that failed. The old branch only named the host for
    // React Native's "Network request failed", so once Expo's fetch started
    // reporting timeouts instead, the error became a bare
    // "UnexpectedException: The request timed out" with nothing to act on.
    const msg = netErr?.message ?? String(netErr);
    const timedOut =
      netErr?.name === 'TimeoutError' || netErr?.name === 'AbortError' || /timed out/i.test(msg);
    throw new Error(
      timedOut
        ? `Couldn't reach the Stride API at ${baseUrl} (timed out). ` +
          'Check the API is running and that the phone is on the same Wi-Fi.'
        : `Couldn't reach the Stride API at ${baseUrl}: ${msg}`,
    );
  }

  // If it 401s, the token may be stale, force a fresh session token and retry once.
  if (response.status === 401 && !options.token) {
    const fresh = await getAccessToken();
    if (fresh && fresh !== token) {
      token = fresh;
      response = await doFetch(fresh);
    }
  }

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({} as Record<string, unknown>));
    const err = new Error(
      errorJson.message || errorJson.error || `HTTP error! status: ${response.status}`,
    ) as Error & { status?: number; code?: string };
    err.status = response.status;
    // Machine-readable error code (e.g. CONSENT_REQUIRED) for callers to branch on.
    if (errorJson.code) err.code = errorJson.code;
    throw err;
  }

  return response.json();
}

export interface OverlayData {
  fps: number;
  sourceFps?: number;
  width: number;
  height: number;
  frames: { tMs: number; kp: number[][]; frameIndex?: number }[];
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

  // Permanently deletes the account and all associated data (App Store 5.1.1(v)).
  deleteAccount: async () => {
    return request<any>('/users/me', { method: 'DELETE' });
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

  // `today` is the athlete's own local date. The server dates completions with
  // it (so a day counts toward the streak only when it was ticked off on the
  // day) and rejects completing work scheduled for a day that hasn't arrived.
  updateEvent: async (
    eventId: string,
    update: { status?: string; completionNote?: string; today?: string },
  ) => {
    return request<any>(`/calendar/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
  },

  // --- Calendar reveal (the card stack) ---
  // Only coach- and analysis-scheduled work shows up here; anything the athlete
  // added by hand is already known to them and never triggers the takeover.
  listUnrevealedEvents: async () => {
    return request<any[]>('/calendar/unrevealed');
  },

  /** Mark cards seen. Omit ids to clear every outstanding reveal (the Skip path). */
  revealEvents: async (eventIds?: string[]) => {
    return request<{ revealed: number }>('/calendar/reveal', {
      method: 'POST',
      body: JSON.stringify(eventIds ? { eventIds } : {}),
    });
  },

  /** Left-swipe: drop a proposed day. Reversible via undoDeclineEvents. */
  declineEvents: async (eventIds: string[]) => {
    return request<{ declined: number; events: any[] }>('/calendar/decline', {
      method: 'POST',
      body: JSON.stringify({ eventIds }),
    });
  },

  undoDeclineEvents: async (eventIds: string[]) => {
    return request<{ restored: number; events: any[] }>('/calendar/decline/undo', {
      method: 'POST',
      body: JSON.stringify({ eventIds }),
    });
  },

  /**
   * Streak summary. `today` is the caller's LOCAL date, the server must not
   * decide when the athlete's day ends (same reason the grid builds its date
   * strings from local calendar fields rather than toISOString()).
   */
  getStreak: async (today: string) => {
    return request<{
      current: number;
      longest: number;
      lastActiveDate: string | null;
      activeDates: string[];
      /** Inclusive ends of the live run, the calendar draws it as one bar. */
      streakStart: string | null;
      streakEnd: string | null;
      atRiskToday: boolean;
    }>(`/calendar/streak?today=${today}`);
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
  // action chips flow through POST /:id/message (no free-text chat, F.5).
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
      timeoutMs: COACH_TIMEOUT_MS,
    });
  },

  // Free-form question to the grounded Groq coach (free_coach sessions).
  askCoach: async (sessionId: string, content: string, history?: { role: string; content: string }[]) => {
    return request<{ role: string; content: string; progress?: string[]; calendarRelevant?: boolean }>(`/coach-sessions/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ content, history: history?.slice(-10) }),
      timeoutMs: COACH_TIMEOUT_MS,
    });
  },

  // Add coach's suggested plan to the user's calendar
  addCoachPlanToCalendar: async (sessionId: string, history?: { role: string; content: string }[]) => {
    return request<{ created: number; events: any[] }>(`/coach-sessions/${sessionId}/add-to-calendar`, {
      method: 'POST',
      body: JSON.stringify({ history: history?.slice(-50) }),
      timeoutMs: COACH_TIMEOUT_MS,
    });
  },

  // Sealing a workflow session is the 'mark_understood' chip.
  sealCoachSession: async (sessionId: string) => {
    return request<any>(`/coach-sessions/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ content: CHIP_LABELS.mark_understood, action_chip: 'mark_understood' }),
      timeoutMs: COACH_TIMEOUT_MS,
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
