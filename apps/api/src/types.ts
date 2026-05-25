import type { Request } from 'express';

// ─── Database row types ───────────────────────────────────────────

export interface User {
  id: string;
  supabase_uid: string;
  email: string;
  display_name: string | null;
  event_specialty: '100m' | '200m' | '400m' | null;
  experience_level: 'beginner' | 'intermediate' | 'advanced' | null;
  personal_best_seconds: number | null;
  created_at: Date;
  date_of_birth: string | null;
  consent_given_at: Date | null;
  consent_version: number;
  parental_consent: boolean;
  drill_intensity_cap: 'moderate' | 'full' | null;
  is_injured: boolean;
}

export interface Analysis {
  id: string;
  user_id: string;
  s3_key: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  movenet_version: string | null;
  overall_score: number | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  analysis_id: string | null;
  messages: ConversationMessage[];
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  event_type: 'workout' | 'rest' | 'competition' | 'drill';
  scheduled_date: string;
  details: Record<string, unknown> | null;
  status: 'scheduled' | 'completed' | 'skipped' | 'modified';
  completion_note: string | null;
  created_at: Date;
}

// ─── Request extensions ───────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;
  supabaseUid: string;
  user: User;
}

// ─── API response types ───────────────────────────────────────────

export interface UploadUrlResponse {
  analysisId: string;
  uploadId: string;
  parts: { partNumber: number; url: string }[];
}

export interface FinalizeRequest {
  analysisId: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}

export interface SSEEvent {
  analysisId: string;
  data: {
    status: Analysis['status'];
    overall_score?: number | null;
    result_json?: Record<string, unknown> | null;
    error_message?: string | null;
    completed_at?: string | null;
  };
}

export interface HealthCheckResult {
  status: 'ok' | 'error';
  components: {
    database: 'ok' | 'error';
    s3: 'ok' | 'error';
    sqs: 'ok' | 'error';
  };
  timestamp: string;
}
