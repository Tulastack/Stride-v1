import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getSuggestionsByAnalysis,
  getDrillSuggestion,
  approveSuggestion,
  skipSuggestion,
  getAnalysis,
} from '../db/queries.js';

const router = Router();

const approveSkipSchema = z.object({
  // nothing required from body for approve/skip
});

/**
 * GET /analyses/:analysisId/suggestions — list suggestions for an analysis.
 * NOTE: this router is mounted at '/analyses', so the path here is relative
 * ('/:analysisId/suggestions') to avoid a double '/analyses/analyses' prefix.
 */
router.get('/:analysisId/suggestions', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId } = req.params;
    const userId = req.userId as string;

    // Validate analysisId is a UUID
    const parsed = z.string().uuid().safeParse(analysisId);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid analysisId' });
      return;
    }

    // Verify ownership
    const analysis = await getAnalysis(analysisId, userId);
    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found' });
      return;
    }

    const suggestions = await getSuggestionsByAnalysis(analysisId, userId);
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /suggestions/:id/approve — approve + create calendar_event (idempotent)
 */
router.post('/:id/approve', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId as string;

    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid suggestion id' });
      return;
    }

    // Validate the suggestion exists and check the date before acting
    const suggestion = await getDrillSuggestion(id, userId);
    if (!suggestion) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }

    // suggested_date comes back from a DATE column as a JS Date (node-pg), so
    // coerce to YYYY-MM-DD using LOCAL parts (pg parses to local midnight —
    // toISOString() would shift the day in negative-UTC timezones) before validating.
    const rawDate: unknown = suggestion.suggested_date;
    const dateStr =
      rawDate instanceof Date
        ? `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`
        : String(rawDate).slice(0, 10);
    const dateResult = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(dateStr);
    if (!dateResult.success) {
      res.status(400).json({ error: 'Invalid suggested_date format in suggestion' });
      return;
    }

    const result = await approveSuggestion(id, userId);
    if (!result) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /suggestions/:id/skip — skip a suggestion
 */
router.post('/:id/skip', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId as string;

    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid suggestion id' });
      return;
    }

    const suggestion = await skipSuggestion(id, userId);
    if (!suggestion) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }

    res.json(suggestion);
  } catch (err) {
    next(err);
  }
});

export default router;
