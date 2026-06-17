/**
 * src/db/supabaseClient.js
 * Shared Supabase client. Reads config from Vite env vars (set via .env.local
 * for local dev, or injected as build-time secrets by the GitHub Actions
 * deploy workflows — see .env.example).
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// Fall back to placeholder values so createClient doesn't throw synchronously
// at import time when env vars are missing — that would blank-screen the
// whole app before any component even mounts. Any real call made against
// these placeholders fails as a normal network error, which the existing
// try/catch around db.* calls already surfaces as a toast/error message.
export const supabase = createClient(
  url || 'https://placeholder.invalid',
  anonKey || 'placeholder-anon-key',
);
