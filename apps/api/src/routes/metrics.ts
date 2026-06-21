import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireConsent } from '../middleware/consent.js';
import { getMetricsTimeline, getMetricsTrend } from '../db/queries.js';
import type { MetricsTimelineRow } from '../types.js';

const router = Router();

/**
 * GET /users/me/metrics?days=30
 * Returns last N days of metrics grouped by metric_key.
 */
router.get(
  '/me/metrics',
  authenticate,
  requireConsent,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { days: daysStr } = z
        .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
        .parse(req.query);

      const rows = await getMetricsTimeline(req.userId as string, daysStr);

      // Group by metric_key
      const grouped: Record<string, MetricsTimelineRow[]> = {};
      for (const row of rows) {
        if (!grouped[row.metric_key]) grouped[row.metric_key] = [];
        grouped[row.metric_key]!.push(row);
      }

      res.json(grouped);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /users/me/metrics/:metric_key/trend?weeks=4
 * Returns weekly trend data for a given metric.
 */
router.get(
  '/me/metrics/:metric_key/trend',
  authenticate,
  requireConsent,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { metric_key } = req.params as { metric_key: string };
      const { weeks: weeksStr } = z
        .object({ weeks: z.coerce.number().int().min(1).max(52).default(4) })
        .parse(req.query);

      const trend = await getMetricsTrend(req.userId as string, metric_key, weeksStr);
      res.json(trend);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
