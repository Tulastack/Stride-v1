import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { CURRENT_CONSENT_VERSION, calculateAge, isMinor } from '../middleware/consent.js';
import { recordConsent } from '../db/queries.js';
import type { AuthenticatedRequest } from '../types.js';

const router = Router();

const consentSchema = z.object({
  consent_version: z.number().int().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  parental_consent: z.boolean().optional().default(false),
});

router.post('/', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { consent_version, date_of_birth, parental_consent } = consentSchema.parse(req.body);
    const userId = (req as AuthenticatedRequest).userId;

    if (consent_version < CURRENT_CONSENT_VERSION) {
      res.status(400).json({
        code: 'CONSENT_VERSION_TOO_OLD',
        message: `Must consent to version ${CURRENT_CONSENT_VERSION} or later.`,
      });
      return;
    }

    let drill_intensity_cap: 'moderate' | 'full' | null = null;
    if (date_of_birth) {
      const dob = new Date(date_of_birth);
      if (isMinor(dob)) {
        if (!parental_consent) {
          res.status(403).json({
            code: 'PARENTAL_CONSENT_REQUIRED',
            message: 'Users under 18 require parental consent to use Stride.',
          });
          return;
        }
        drill_intensity_cap = 'moderate';
      } else {
        drill_intensity_cap = 'full';
      }
    }

    const user = await recordConsent(userId, {
      consent_version,
      date_of_birth: date_of_birth ?? null,
      parental_consent,
      drill_intensity_cap,
    });

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
