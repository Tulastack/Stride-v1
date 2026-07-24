import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types.js';
import { getUserBySupabaseUid, updateUser, updateInjuryStatus, deleteUserAccount } from '../db/queries.js';
import { isLocalStorage, LOCAL_STORAGE_DIR } from '../lib/storage.js';

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
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * Account deletion (App Store Guideline 5.1.1(v)): removes the DB user (FKs
 * cascade through analyses/calendar/coach/metrics), the stored videos, and —
 * when a service-role key is configured — the Supabase auth user itself.
 */
router.delete('/me', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    // Best-effort: remove stored videos + sidecars before the rows go away.
    try {
      if (isLocalStorage) {
        fs.rmSync(path.join(LOCAL_STORAGE_DIR, 'uploads', userId), { recursive: true, force: true });
      } else {
        const { deletePrefix } = await import('../lib/s3.js');
        await deletePrefix(`uploads/${userId}/`);
      }
    } catch (cleanupErr) {
      console.warn(`[users/me DELETE] video cleanup failed for ${userId}:`, cleanupErr);
    }

    const supabaseUid = await deleteUserAccount(userId);
    if (!supabaseUid) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Best-effort: delete the auth user so the email can re-register cleanly.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey && process.env.SUPABASE_URL) {
      try {
        const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${supabaseUid}`, {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        if (!resp.ok) {
          console.warn(`[users/me DELETE] Supabase auth deletion returned ${resp.status} for ${supabaseUid}`);
        }
      } catch (authErr) {
        console.warn('[users/me DELETE] Supabase auth deletion failed:', authErr);
      }
    } else {
      console.warn('[users/me DELETE] SUPABASE_SERVICE_ROLE_KEY not set — auth user not deleted (re-registration still works via email re-link).');
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
