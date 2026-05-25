import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types.js';
import { getUserBySupabaseUid, updateUser, updateInjuryStatus } from '../db/queries.js';

const router = Router();

const updateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
  eventSpecialty: z.enum(['100m', '200m', '400m']).optional(),
  experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  personalBestSeconds: z.number().positive().max(120).optional(),
});

/**
 * 1. Get current authenticated user profile
 */
router.get('/me', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const supabaseUid = req.supabaseUid;
    const user = await getUserBySupabaseUid(supabaseUid);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Update user profile fields
 */
router.patch('/me', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const fields = updateProfileSchema.parse(req.body);
    const userId = req.userId;

    const dbFields: Parameters<typeof updateUser>[1] = {};
    if (fields.displayName !== undefined) dbFields.display_name = fields.displayName;
    if (fields.eventSpecialty !== undefined) dbFields.event_specialty = fields.eventSpecialty;
    if (fields.experienceLevel !== undefined) dbFields.experience_level = fields.experienceLevel;
    if (fields.personalBestSeconds !== undefined) dbFields.personal_best_seconds = fields.personalBestSeconds;

    const updatedUser = await updateUser(userId, dbFields);
    if (!updatedUser) {
      res.status(400).json({ error: 'No fields to update or user not found' });
      return;
    }

    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

router.patch('/me/injury', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { is_injured } = z.object({ is_injured: z.boolean() }).parse(req.body);
    const userId = (req as AuthenticatedRequest).userId;
    const user = await updateInjuryStatus(userId, is_injured);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
