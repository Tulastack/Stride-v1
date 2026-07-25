// Progressive drill programs (targeted plan generation).
//
// Approving a drill suggestion used to create a single one-off calendar event.
// That produced a list of disconnected activities, not a plan that actually
// builds a skill over time. This turns one approval into a real multi-week
// block: a fixed frequency per week, sessions spaced so the same drill never
// lands on back-to-back days, and volume that progresses instead of staying
// flat for the whole block.

export interface ProgramSession {
  title: string;
  eventType: 'drill';
  scheduledDate: string; // YYYY-MM-DD
  details: {
    drill_key: string;
    sets: number;
    reps: number;
    cue: string;
    week: number;
    drill_suggestion_id: string;
  };
}

export interface DrillProgramBase {
  drillKey: string;
  drillName: string;
  cue: string;
  sets: number;
  reps: number;
}

const WEEKS = 3;
const SESSIONS_PER_WEEK = 2;
const DAYS_BETWEEN_SESSIONS = 3;
// Hold volume for the first two weeks to groove the pattern, then step it up —
// a real progression instead of repeating the same session N times.
const REP_PROGRESSION = [1, 1, 1.25];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the full progressive program for one approved drill suggestion. Pure:
 * same inputs always yield the same output.
 */
export function generateDrillProgram(
  base: DrillProgramBase,
  suggestionId: string,
  startDate: string,
): ProgramSession[] {
  const sessions: ProgramSession[] = [];
  for (let week = 0; week < WEEKS; week++) {
    const reps = Math.round(base.reps * (REP_PROGRESSION[week] ?? 1));
    for (let session = 0; session < SESSIONS_PER_WEEK; session++) {
      const dayOffset = week * 7 + session * DAYS_BETWEEN_SESSIONS;
      sessions.push({
        title: base.drillName,
        eventType: 'drill',
        scheduledDate: addDays(startDate, dayOffset),
        details: {
          drill_key: base.drillKey,
          sets: base.sets,
          reps,
          cue: base.cue,
          week: week + 1,
          drill_suggestion_id: suggestionId,
        },
      });
    }
  }
  return sessions;
}
