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
} from '../db/queries.js';

const router = Router();

const eventTypeSchema = z.enum(['workout', 'rest', 'competition', 'drill']);
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

export default router;
