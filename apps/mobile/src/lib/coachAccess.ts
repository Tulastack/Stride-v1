export interface CoachPermissions { analysis: boolean; calendar: boolean; profile: boolean; app: boolean }
export const NO_COACH_ACCESS: CoachPermissions = { analysis: false, calendar: false, profile: false, app: false };
export const FULL_COACH_ACCESS: CoachPermissions = { analysis: true, calendar: true, profile: true, app: true };
/** remaining is null when the server runs without a cap. */
export interface CoachUsage { used: number; cap: number; remaining: number | null; period: string }
export interface CoachProposal {
  token: string; label: string;
  action: { kind: string; events?: { title: string; scheduledDate: string; eventType: string; details?: Record<string, unknown> }[];
    changes?: Record<string, unknown>; screen?: string; analysisId?: string; value?: 'light' | 'dark' | 'system' | boolean;
    status?: 'completed' | 'skipped' | 'scheduled'; suggestionId?: string; eventId?: string };
  before?: { title?: string; scheduled_date?: string; [key: string]: unknown };
}
function detailsText(details: Record<string, unknown>): string {
  const names: Record<string, string> = { sets: 'Sets', reps: 'Reps', volume: 'Volume', cue: 'Cue', notes: 'Notes' };
  return Object.entries(details).map(([k,v]) => `${names[k] ?? k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}
function suggestionName(before: CoachProposal['before']): string {
  const drill = before?.drill_name ?? before?.drillName ?? before?.title;
  return typeof drill === 'string' ? drill : 'Drill suggestion';
}
export function proposalDetails(proposal: CoachProposal): string {
  const a = proposal.action;
  if (a.events) return a.events.map((e) => `${e.scheduledDate}: ${e.title} (${e.eventType.replace(/_/g, ' ')})${e.details && Object.keys(e.details).length ? '\n' + detailsText(e.details) : ''}`).join('\n');
  if (a.kind === 'delete_event') return `${proposal.before?.scheduled_date}: ${proposal.before?.title}`;
  if (a.kind === 'set_event_status') return `${proposal.before?.scheduled_date}: ${proposal.before?.title}\nMark as ${a.status}`;
  if (a.kind === 'approve_suggestion') return `${suggestionName(proposal.before)}\nAdds it to your training`;
  if (a.kind === 'skip_suggestion') return `${suggestionName(proposal.before)}\nSets it aside`;
  if (a.kind === 'reduce_motion') return a.value ? 'Reduce motion: on' : 'Reduce motion: off';
  if (a.changes) {
    const names: Record<string, string> = { scheduledDate: 'Move to', title: 'Title', eventType: 'Session type', display_name: 'Name', event_specialty: 'Event', experience_level: 'Experience', personal_best_seconds: 'Personal best (seconds)' };
    return `${proposal.before?.title ? `Current: ${proposal.before.scheduled_date}, ${proposal.before.title}\n` : ''}${Object.entries(a.changes).map(([k,v]) => k === 'details' ? detailsText(v as Record<string, unknown>) : `${names[k] ?? k.replace(/_/g, ' ')}: ${v}`).join('\n')}`;
  }
  return a.screen ?? (typeof a.value === 'string' ? a.value : '');
}

/** Caption under the composer; null hides it (no cap, or plenty left). */
export function usageCaption(usage: CoachUsage | null): string | null {
  if (!usage || usage.remaining == null) return null;
  const span = usage.period === 'beta' ? 'for the beta' : 'this month';
  if (usage.remaining === 0) return `You have used all ${usage.cap} coach messages ${span}. Your plan, analyses and calendar remain fully available.`;
  return `${usage.remaining} of ${usage.cap} coach messages left ${span}`;
}
