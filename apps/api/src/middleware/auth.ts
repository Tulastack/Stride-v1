import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getUserBySupabaseUid, createUser } from '../db/queries.js';
import type { AuthenticatedRequest } from '../types.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

// Cache the JWKS – createRemoteJWKSet handles internal caching/rotation
const jwksUrl = new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
const JWKS = createRemoteJWKSet(jwksUrl);

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });

    const supabaseUid = payload.sub;
    if (!supabaseUid) {
      res.status(401).json({ error: 'Token missing subject claim' });
      return;
    }

    const email = (payload.email as string) ?? '';

    // Look up or auto-create user in DB
    let user = await getUserBySupabaseUid(supabaseUid);
    if (!user) {
      user = await createUser(supabaseUid, email);
    }

    // Attach to request
    (req as AuthenticatedRequest).userId = user.id;
    (req as AuthenticatedRequest).supabaseUid = supabaseUid;
    (req as AuthenticatedRequest).user = user;

    next();
  } catch (err) {
    console.error('JWT verification failed:', err);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
