import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// The project ships with placeholder values (a leftover from the original
// scaffold, not a real project) — detect that case explicitly so the UI can
// show a clean "not configured yet" state instead of attempting a network
// call to a fake domain and surfacing a cryptic error.
export const isSupabaseConfigured =
  !!SUPABASE_URL &&
  !!SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('dummy') &&
  !SUPABASE_ANON_KEY.toLowerCase().includes('dummykey');

// A single shared client for the whole app — createClient() sets up its own
// internal listeners/storage, so this must not be re-created per component.
// Safe to construct even with placeholder values; isSupabaseConfigured is
// what actually gates whether any auth call is attempted.
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      // Session persists in localStorage by default (Supabase's normal
      // behavior) — this is what makes the session survive a closed/reopened
      // browser, satisfying the "persist across Tesla browser restarts"
      // requirement with zero extra code.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
