import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types.js';

export const CURRENT_CONSENT_VERSION = 1;

export function calculateAge(dateOfBirth: Date, referenceDate: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function isMinor(dateOfBirth: Date, referenceDate: Date = new Date()): boolean {
  return calculateAge(dateOfBirth, referenceDate) < 18;
}

export function requireConsent(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;

  if (!user.consent_given_at) {
    res.status(403).json({
      code: 'CONSENT_REQUIRED',
      message: 'You must accept the terms and conditions before using this feature.',
    });
    return;
  }

  if ((user.consent_version ?? 0) < CURRENT_CONSENT_VERSION) {
    res.status(403).json({
      code: 'CONSENT_OUTDATED',
      message: 'Our terms have been updated. Please re-accept to continue.',
    });
    return;
  }

  next();
}
