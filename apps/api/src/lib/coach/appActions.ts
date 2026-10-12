import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const permissionsSchema = z.object({
  analysis: z.boolean().default(false), calendar: z.boolean().default(false),
  profile: z.boolean().default(false), app: z.boolean().default(false),
}).strict();
export type CoachPermissions = z.infer<typeof permissionsSchema>;
export const NO_ACCESS: CoachPermissions = { analysis: false, calendar: false, profile: false, app: false };
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Invalid calendar date');
const eventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  eventType: z.enum(['workout', 'drill', 'rest', 'competition', 'hydration', 'recovery', 'cross_training']),
  scheduledDate: dateSchema, details: z.record(z.unknown()).default({}),
}).strict();
const profileSchema = z.object({
  display_name: z.string().max(100).optional(),
  event_specialty: z.enum(['100m', '200m', '400m']).optional(),
  experience_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  personal_best_seconds: z.number().positive().max(120).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Specify a profile change');
export const appActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_events'), events: z.array(eventSchema).min(1).max(40) }).strict(),
  z.object({ kind: z.literal('update_event'), eventId: z.string().uuid(), changes: eventSchema.partial()
    .refine((v) => Object.keys(v).length > 0, 'Specify a change') }).strict(),
  z.object({ kind: z.literal('delete_event'), eventId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('update_profile'), changes: profileSchema }).strict(),
  z.object({ kind: z.literal('navigate'), screen: z.enum(['capture', 'progress', 'analysis', 'coach', 'calendar', 'settings']), analysisId: z.string().uuid().optional() }).strict(),
  z.object({ kind: z.literal('appearance'), value: z.enum(['light', 'dark', 'system']) }).strict(),
  z.object({ kind: z.literal('reduce_motion'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('approve_suggestion'), suggestionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('skip_suggestion'), suggestionId: z.string().uuid() }).strict(),
  // `today` is stamped by the server from the athlete's clock, never by the model.
  z.object({ kind: z.literal('set_event_status'), eventId: z.string().uuid(),
    status: z.enum(['completed', 'skipped', 'scheduled']), today: dateSchema.optional() }).strict(),
]);
export type AppAction = z.infer<typeof appActionSchema>;
export interface ActionProposal { token: string; label: string; action: AppAction; before?: any }
export function actionScope(action: AppAction): keyof CoachPermissions {
  return action.kind.endsWith('event') || action.kind === 'create_events' || action.kind === 'set_event_status'
    || action.kind === 'approve_suggestion' || action.kind === 'skip_suggestion' ? 'calendar'
    : action.kind === 'update_profile' ? 'profile' : 'app';
}
export function snapshot(value: any): string {
  // Only mutable scheduling fields, excluding parser-dependent timestamps.
  return JSON.stringify(value ? { title: value.title, event_type: value.event_type,
    scheduled_date: value.scheduled_date, status: value.status, details: value.details } : null);
}
function secret(): string {
  const value = process.env.COACH_ACTION_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!value) throw new Error('Coach action approval is not configured');
  return value;
}
export function signProposal(userId: string, sessionId: string, action: AppAction, before?: any): ActionProposal {
  const payload = Buffer.from(JSON.stringify({ userId, sessionId, action, before,
    nonce: randomUUID(), expires: Date.now() + 30 * 60_000 })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  const label = action.kind === 'create_events' ? `Add ${action.events.length} sessions`
    : action.kind === 'update_event' ? `Change ${before?.title ?? 'session'}`
    : action.kind === 'delete_event' ? `Delete ${before?.title ?? 'session'}`
    : action.kind === 'update_profile' ? 'Update athlete profile'
    : action.kind === 'navigate' ? `Open ${action.screen}`
    : action.kind === 'appearance' ? `Use ${action.value} appearance`
    : action.kind === 'reduce_motion' ? `Turn reduce motion ${action.value ? 'on' : 'off'}`
    : action.kind === 'approve_suggestion' ? `Schedule ${before?.drill_name ?? 'suggested drill'}`
    : action.kind === 'skip_suggestion' ? `Skip ${before?.drill_name ?? 'suggested drill'}`
    : `Mark ${before?.title ?? 'session'} ${action.status === 'scheduled' ? 'as not done' : action.status}`;
  return { token: `${payload}.${signature}`, action, label, before };
}
export function verifyProposal(token: string, userId: string, sessionId: string) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('Invalid action approval');
  const expected = createHmac('sha256', secret()).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('Invalid action approval');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (decoded.userId !== userId || decoded.sessionId !== sessionId || decoded.expires < Date.now()) throw new Error('Action approval expired or belongs to another session');
  return { ...decoded, action: appActionSchema.parse(decoded.action) } as {
    action: AppAction; before?: any; nonce: string;
  };
}

/** Action status is application-owned; model prose cannot claim an unapproved
 * write succeeded or invent unrelated form observations after proposing it. */
export function proposalReply(proposals: ActionProposal[]): string {
  const lines = proposals.map(({ action: a, before, label }) => {
    if (a.kind === 'update_event') return `• Proposed change to ${before?.title ?? 'session'}: ${Object.entries(a.changes).map(([k,v]) => `${({ scheduledDate: 'move to', eventType: 'session type', title: 'title', details: 'workout details' } as Record<string, string>)[k] ?? k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')}.`;
    if (a.kind === 'delete_event') return `• Proposed deletion: ${before?.title ?? 'session'} on ${before?.scheduled_date ?? 'its scheduled day'}.`;
    if (a.kind === 'create_events') return `• Proposed plan: ${a.events.length} sessions, from ${a.events[0].scheduledDate} to ${a.events[a.events.length - 1].scheduledDate}.`;
    if (a.kind === 'approve_suggestion') return `• Proposed: schedule the ${before?.drill_name ?? 'suggested drill'} program from your analysis.`;
    if (a.kind === 'set_event_status') return `• Proposed: mark ${before?.title ?? 'session'} on ${before?.scheduled_date ?? 'its day'} as ${a.status === 'scheduled' ? 'not done' : a.status}.`;
    return `• Proposed: ${label}.`;
  });
  return `PLAN:\n${lines.join('\n')}\n\nTIP:\nReview the exact changes below. Nothing has changed yet.`;
}
