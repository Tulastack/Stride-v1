import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getReferenceDrill, getAllReferencedrills } from '../db/queries.js';

const router = Router();

/**
 * GET /reference-drills — return all reference drills
 */
router.get('/', authenticate, async (_req: any, res: Response, next: NextFunction) => {
  try {
    const drills = await getAllReferencedrills();
    res.json(drills);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /reference-drills/:key — return single drill or 404
 */
router.get('/:key', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params as { key: string };
    const drill = await getReferenceDrill(key);
    if (!drill) {
      res.status(404).json({ code: 'DRILL_NOT_FOUND' });
      return;
    }
    res.json(drill);
  } catch (err) {
    next(err);
  }
});

export default router;
