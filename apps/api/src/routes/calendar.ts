import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types.js';
import {
  createCalendarEvent,
  createCalendarEvents,
  getCalendarEvents,
  updateCalendarEvent,
  getUnrevealedEvents,
  markEventsRevealed,
  declineEvents,
  restoreEvents,
  getTrainingDays,
} from '../db/queries.js';
import { computeStreak } from '../calendar/streak.js';

const router = Router();

// Keep in sync with the calendar_events.event_type CHECK constraint (schema.sql)
const eventTypeSchema = z.enum(['workout', 'rest', 'competition', 'drill', 'hydration', 'recovery', 'cross_training']);
const statusSchema = z.enum(['scheduled', 'completed', 'skipped', 'modified']);

const singleEventSchema = z.object({
  title: z.string().min(1).max(200),
  eventType: eventTypeSchema,
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
  details: z.record(z.any()).optional(),
});

const createEventsRequestSchema = z.union([
  singleEventSchema,
  z.array(singleEventSchema),
]);

const updateEventRequestSchema = z.object({
  status: statusSchema.optional(),
  completionNote: z.string().max(1000).optional(),
});

/**
 * 1. Create a single calendar event or bulk create multiple events
 */
router.post('/events', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const data = createEventsRequestSchema.parse(req.body);
    const userId = req.userId;

    if (Array.isArray(data)) {
      const dbEvents = data.map((e) => ({
        title: e.title,
        event_type: e.eventType,
        scheduled_date: e.scheduledDate,
        details: e.details,
      }));
      const created = await createCalendarEvents(userId, dbEvents);
      res.json(created);
    } else {
      const created = await createCalendarEvent(userId, {
        title: data.title,
        event_type: data.eventType,
        scheduled_date: data.scheduledDate,
        details: data.details,
      });
      res.json(created);
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Get events within a date range
 */
router.get('/events', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      res.status(400).json({ error: "Missing required query parameters 'from' and 'to' in YYYY-MM-DD format" });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      res.status(400).json({ error: "Invalid date format for 'from' or 'to'. Must be YYYY-MM-DD" });
      return;
    }

    const userId = req.userId;
    const events = await getCalendarEvents(userId, from, to);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

/**
 * 3. Update status or add completion note to an event
 */
router.patch('/events/:eventId', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { eventId } = req.params;
    const { status, completionNote } = updateEventRequestSchema.parse(req.body);
    const userId = req.userId;

    const updated = await updateCalendarEvent(eventId, userId, {
      status,
      completion_note: completionNote,
    });

    if (!updated) {
      res.status(404).json({ error: 'Calendar event not found or unauthorized' });
      return;
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * 4. Everything scheduled for the athlete that they have not been shown yet.
 *    Feeds the Plan tab's full-screen card reveal. Manual events never appear
 *    here — the athlete already knows about work they added themselves.
 */
router.get('/unrevealed', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const events = await getUnrevealedEvents(req.userId);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

const revealRequestSchema = z.object({
  // Omitted = clear every outstanding reveal (what "Skip" sends).
  eventIds: z.array(z.string().uuid()).max(500).optional(),
});

/**
 * 5. Mark reveal cards as seen — sent when the stack is swiped through or
 *    skipped. Idempotent: re-sending ids already revealed is a no-op.
 */
router.post('/reveal', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { eventIds } = revealRequestSchema.parse(req.body ?? {});
    const revealed = await markEventsRevealed(req.userId, eventIds);
    res.json({ revealed });
  } catch (err) {
    next(err);
  }
});

const declineRequestSchema = z.object({
  eventIds: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * 6. Left-swipe on a day card: drop that day's proposed work. Events are
 *    marked 'skipped' rather than deleted, so /decline/undo can put the day
 *    back and the decision stays on the record.
 */
router.post('/decline', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { eventIds } = declineRequestSchema.parse(req.body);
    const declined = await declineEvents(req.userId, eventIds);
    res.json({ declined: declined.length, events: declined });
  } catch (err) {
    next(err);
  }
});

/** 7. Undo a decline. */
router.post('/decline/undo', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { eventIds } = declineRequestSchema.parse(req.body);
    const restored = await restoreEvents(req.userId, eventIds);
    res.json({ restored: restored.length, events: restored });
  } catch (err) {
    next(err);
  }
});

/**
 * 8. Streak summary. `today` is supplied by the client in its own local date
 *    so the streak flips at the athlete's midnight, not the server's — the
 *    same local-date discipline the calendar grid already follows.
 */
router.get('/streak', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const todayParam = req.query.today as string | undefined;
    if (todayParam && !/^\d{4}-\d{2}-\d{2}$/.test(todayParam)) {
      res.status(400).json({ error: "Invalid 'today' — must be YYYY-MM-DD" });
      return;
    }
    const today = todayParam ?? new Date().toISOString().slice(0, 10);
    const days = await getTrainingDays(req.userId);
    res.json(computeStreak(days, today));
  } catch (err) {
    next(err);
  }
});

export default router;
