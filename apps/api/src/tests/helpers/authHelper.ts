import { SignJWT } from 'jose';

const TEST_JWT_SECRET = new TextEncoder().encode(
  process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-at-least-32-characters-long'
);

export async function mintTestJwt(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(TEST_JWT_SECRET);
}
