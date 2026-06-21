// Pure proposal generation for the mobile review gate (PROMPT F.7).
// Mirrors apps/api/src/calendar/proposal.ts. No side effects: building a
// proposal never writes; only an explicit approval tap commits.
import type { DrillRec } from '../types/analysis';

export interface ProposedSession {
  id: string;
  title: string;
  scheduledDate: string;
  cue: string;
  sets: number;
  reps: number;
  flawId: string;
  drillId: string;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function generateProposal(
  focus: DrillRec,
  startDate: string,
  sessions = 3,
  everyNDays = 2
): ProposedSession[] {
  const out: ProposedSession[] = [];
  for (let i = 0; i < Math.max(1, sessions); i++) {
    out.push({
      id: `${focus.drillId}-${i}`,
      title: focus.drillName,
      scheduledDate: addDays(startDate, i * everyNDays),
      cue: focus.cue,
      sets: focus.sets,
      reps: focus.reps,
      flawId: focus.flawId,
      drillId: focus.drillId,
    });
  }
  return out;
}
