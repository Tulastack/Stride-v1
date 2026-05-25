import { jest } from '@jest/globals';
import { calculateAge, isMinor, requireConsent, CURRENT_CONSENT_VERSION } from '../consent.js';
import type { User } from '../../types.js';

// ─── calculateAge unit tests ──────────────────────────────────────────────────

describe('calculateAge', () => {
  it('returns correct age for a simple case', () => {
    const dob = new Date('1990-06-15');
    const ref = new Date('2024-06-15');
    expect(calculateAge(dob, ref)).toBe(34);
  });

  it('returns correct age when birthday has not yet occurred this year', () => {
    const dob = new Date('2000-12-31');
    const ref = new Date('2024-06-01');
    expect(calculateAge(dob, ref)).toBe(23);
  });

  it('returns correct age when birthday is today (boundary)', () => {
    const dob = new Date('2006-03-15');
    const ref = new Date('2024-03-15');
    expect(calculateAge(dob, ref)).toBe(18);
  });

  it('handles year boundary correctly (Dec 31 → Jan 1)', () => {
    // Born Dec 31, 2006. On Jan 1 2024 they are still 17.
    const dob = new Date('2006-12-31');
    const ref = new Date('2024-01-01');
    expect(calculateAge(dob, ref)).toBe(17);
  });

  it('handles leap year birthday (Feb 29) — non-leap reference year', () => {
    // Born Feb 29 2000. On Feb 28 2023 they are still 22 (haven't had birthday yet).
    const dob = new Date('2000-02-29');
    const ref = new Date('2023-02-28');
    expect(calculateAge(dob, ref)).toBe(22);
  });

  it('handles leap year birthday (Feb 29) — on Mar 1 of non-leap year', () => {
    // Born Feb 29 2000. On Mar 1 2023 they are 23.
    const dob = new Date('2000-02-29');
    const ref = new Date('2023-03-01');
    expect(calculateAge(dob, ref)).toBe(23);
  });

  it('counts across year boundaries (Jan 1)', () => {
    // Born Jan 1, 2007. On Dec 31 2024 they are 17.
    const dob = new Date('2007-01-01');
    const ref = new Date('2024-12-31');
    expect(calculateAge(dob, ref)).toBe(17);
  });

  it('returns 0 for a newborn', () => {
    const today = new Date('2024-08-01');
    const dob = new Date('2024-08-01');
    expect(calculateAge(dob, today)).toBe(0);
  });
});

// ─── isMinor unit tests ───────────────────────────────────────────────────────

describe('isMinor', () => {
  it('returns true when person is 17 years old', () => {
    const dob = new Date('2007-06-01');
    const ref = new Date('2024-06-01');
    expect(isMinor(dob, ref)).toBe(true);
  });

  it('returns false when person is exactly 18 years old (birthday today)', () => {
    const dob = new Date('2006-06-01');
    const ref = new Date('2024-06-01');
    expect(isMinor(dob, ref)).toBe(false);
  });

  it('returns false when person is 25 years old', () => {
    const dob = new Date('1999-01-15');
    const ref = new Date('2024-06-01');
    expect(isMinor(dob, ref)).toBe(false);
  });

  it('returns true for a person born on Dec 31 checked on Jan 1 (year-boundary edge)', () => {
    // Born Dec 31 2007. On Jan 1 2025 they are 17.
    const dob = new Date('2007-12-31');
    const ref = new Date('2025-01-01');
    expect(isMinor(dob, ref)).toBe(true);
  });
});

// ─── requireConsent middleware unit tests ─────────────────────────────────────

function makeReqResNext(userOverrides: Partial<User> = {}) {
  const defaultUser: User = {
    id: 'user-123',
    supabase_uid: 'sup-123',
    email: 'test@stride.ai',
    display_name: null,
    event_specialty: null,
    experience_level: null,
    personal_best_seconds: null,
    created_at: new Date(),
    date_of_birth: null,
    consent_given_at: new Date(),
    consent_version: CURRENT_CONSENT_VERSION,
    parental_consent: false,
    drill_intensity_cap: null,
    is_injured: false,
  };

  const req: any = { user: { ...defaultUser, ...userOverrides } };
  const res: any = {
    _status: 0,
    _body: {} as any,
    status(code: number) { this._status = code; return this; },
    json(body: any) { this._body = body; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('requireConsent middleware', () => {
  it('calls next() when consent is valid', () => {
    const { req, res, next } = makeReqResNext();
    requireConsent(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(0); // not set
  });

  it('returns 403 CONSENT_REQUIRED when consent_given_at is null', () => {
    const { req, res, next } = makeReqResNext({ consent_given_at: null });
    requireConsent(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CONSENT_REQUIRED');
  });

  it('returns 403 CONSENT_OUTDATED when consent_version is 0 (old)', () => {
    const { req, res, next } = makeReqResNext({ consent_version: 0 });
    requireConsent(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CONSENT_OUTDATED');
  });

  it('returns 403 CONSENT_OUTDATED when consent_version is below current', () => {
    // Simulate consent version 1 when CURRENT is 2
    // We can't easily change CURRENT_CONSENT_VERSION, so simulate user with version 0
    const { req, res, next } = makeReqResNext({ consent_version: 0, consent_given_at: new Date() });
    requireConsent(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CONSENT_OUTDATED');
  });

  it('returns 403 CONSENT_REQUIRED when both consent_given_at is null and version is 0', () => {
    const { req, res, next } = makeReqResNext({ consent_given_at: null, consent_version: 0 });
    requireConsent(req, res, next);
    // consent_given_at check comes first
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CONSENT_REQUIRED');
  });

  it('calls next() when consent_version equals CURRENT_CONSENT_VERSION', () => {
    const { req, res, next } = makeReqResNext({
      consent_given_at: new Date(),
      consent_version: CURRENT_CONSENT_VERSION,
    });
    requireConsent(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
