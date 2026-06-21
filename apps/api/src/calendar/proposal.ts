// Calendar proposal generation (PROMPT F.7) — PURE, no side effects.
//
// From the week's focus drill we generate a PROPOSED schedule (draft only).
// Nothing here writes anything: the only write path is an explicit user
// approval (see CalendarProvider.commit). Do NOT call this on analysis
// completion to auto-create events.

import type { DrillRec } from '@stride/types';

export interface ProposedSession {
  title: string;
  eventType: 'drill' | 'rest';
  scheduledDate: string; // YYYY-MM-DD
  details: { flawId: string; drillId: string; cue: string; sets: number; reps: number };
}

export interface ProposalOptions {
  /** ISO date (YYYY-MM-DD) to anchor the plan; defaults handled by caller. */
  startDate: string;
  /** How many drill sessions to schedule this week. */
  sessions?: number;
  /** Day gap between sessions. */
  everyNDays?: number;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a proposed (uncommitted) schedule for a single focus drill. Pure: same
 * inputs always yield the same output, and it touches no database.
 */
export function generateProposal(focus: DrillRec, opts: ProposalOptions): ProposedSession[] {
  const sessions = Math.max(1, opts.sessions ?? 3);
  const gap = Math.max(1, opts.everyNDays ?? 2);
  const out: ProposedSession[] = [];
  for (let i = 0; i < sessions; i++) {
    out.push({
      title: focus.drillName,
      eventType: 'drill',
      scheduledDate: addDays(opts.startDate, i * gap),
      details: {
        flawId: focus.flawId,
        drillId: focus.drillId,
        cue: focus.cue,
        sets: focus.sets,
        reps: focus.reps,
      },
    });
  }
  return out;
}
