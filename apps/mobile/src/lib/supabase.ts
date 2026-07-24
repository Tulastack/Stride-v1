// Env-driven Supabase client for real authentication.
//
// Configure via app env (never commit these):
//   EXPO_PUBLIC_SUPABASE_URL       = https://<project>.supabase.co
//   EXPO_PUBLIC_SUPABASE_ANON_KEY  = <public anon/publishable key>  (NOT the JWT secret)
//
// If either is absent, `supabase` is null and the auth screens surface a
// configuration error — there is no demo/mock fallback in the app.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Always return a VALID access token. `getSession()` transparently refreshes an
 * expired token (autoRefreshToken), so callers never send a stale JWT. Returns
 * null when Supabase isn't configured.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
