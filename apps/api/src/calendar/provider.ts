// CalendarProvider seam (PROMPT F.7).
//
// The ONLY path that writes calendar events. Approval (an explicit user tap)
// calls commit(); proposal generation never does. Google Calendar (via MCP) is
// deferred to the integrations phase and stubbed clearly.

import type { ProposedSession } from './proposal.js';

export interface CommittedEvent {
  id: string;
  title: string;
  scheduledDate: string;
}

export interface CalendarProvider {
  /** Write the approved sessions. This is the only write path. */
  commit(userId: string, sessions: ProposedSession[]): Promise<CommittedEvent[]>;
}

/** Writes to the local calendar_events table (current default). */
export class LocalCalendarProvider implements CalendarProvider {
  constructor(
    private readonly createCalendarEvents: (
      userId: string,
      events: { title: string; event_type: string; scheduled_date: string; details?: unknown }[]
    ) => Promise<{ id: string; title: string; scheduled_date: string }[]>
  ) {}

  async commit(userId: string, sessions: ProposedSession[]): Promise<CommittedEvent[]> {
    if (sessions.length === 0) return [];
    const rows = await this.createCalendarEvents(
      userId,
      sessions.map((s) => ({
        title: s.title,
        event_type: s.eventType,
        scheduled_date: s.scheduledDate,
        details: s.details,
      }))
    );
    return rows.map((r) => ({ id: r.id, title: r.title, scheduledDate: r.scheduled_date }));
  }
}

/** Google Calendar via MCP — DO NOT IMPLEMENT NOW (integrations phase). */
export class GoogleCalendarProvider implements CalendarProvider {
  // TODO(integrations): wire Google Calendar via MCP. Do NOT auto-sync.
  async commit(): Promise<CommittedEvent[]> {
    throw new Error('Google Calendar not wired — deferred to the integrations phase');
  }
}
