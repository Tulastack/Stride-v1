// Test mock for src/lib/supabase — avoids loading the native Supabase SDK /
// AsyncStorage in jest. Demo-mode semantics: not configured, no token.
module.exports = {
  supabase: null,
  isSupabaseConfigured: false,
  getAccessToken: async () => null,
};
