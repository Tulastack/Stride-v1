// ─── User Types ───────────────────────────────────────────────────

export type EventSpecialty = '100m' | '200m' | '400m';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export interface User {
  id: string;
  supabase_uid: string;
  email: string;
  display_name: string | null;
  event_specialty: EventSpecialty | null;
  experience_level: ExperienceLevel | null;
  personal_best_seconds: number | null;
  created_at: string;
}

export interface UpdateUserRequest {
  display_name?: string;
  event_specialty?: EventSpecialty;
  experience_level?: ExperienceLevel;
  personal_best_seconds?: number;
}

// ─── Health Check Types ───────────────────────────────────────────

export type ServiceStatus = 'ok' | 'error';

export interface HealthCheckResponse {
  api: ServiceStatus;
  db: ServiceStatus;
  sqs: ServiceStatus;
  s3: ServiceStatus;
}
