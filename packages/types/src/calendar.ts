// ─── Calendar Types ───────────────────────────────────────────────

export type EventType = 'workout' | 'rest' | 'competition' | 'drill';
export type EventStatus = 'scheduled' | 'completed' | 'skipped' | 'modified';

export interface CalendarEventDetails {
  intensity?: 'low' | 'medium' | 'high';
  volume?: string;
  purpose?: string;
  warmup?: string;
  cooldown?: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  event_type: EventType;
  scheduled_date: string;
  details: CalendarEventDetails | null;
  status: EventStatus;
  completion_note: string | null;
  created_at: string;
}

export interface CreateCalendarEventRequest {
  title: string;
  event_type: EventType;
  scheduled_date: string;
  details?: CalendarEventDetails;
}

export interface UpdateCalendarEventRequest {
  status: EventStatus;
  completion_note?: string;
}
