import { useStrideStore } from '../store/useStrideStore';

interface FetchOptions extends RequestInit {
  token?: string | null;
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const state = useStrideStore.getState();
  const token = options.token ?? state.token;
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

  requestUploadUrls: async (numParts: number) => {
    return request<{ analysisId: string; uploadId: string; parts: { partNumber: number; url: string }[] }>('/videos/upload-url', {
      method: 'POST',
      body: JSON.stringify({ numParts }),
    });
  },

  finalizeUpload: async (analysisId: string, uploadId: string, parts: { partNumber: number; etag: string }[]) => {
    return request<any>('/videos/finalize', {
      method: 'POST',
      body: JSON.stringify({ analysisId, uploadId, parts }),
    });
  },

  // --- Agent / Chat ---
  createConversation: async (analysisId?: string) => {
    return request<any>('/agent/conversations', {
      method: 'POST',
      body: JSON.stringify({ analysisId }),
    });
  },

  getConversation: async (conversationId: string) => {
    return request<any>(`/agent/conversations/${conversationId}`);
  },

  sendMessage: async (conversationId: string, content: string) => {
    return request<any>(`/agent/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

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
};
