/**
 * src/db/sessionToken.js — single source of truth for the localStorage key
 * that holds the current session token (see auth/AuthContext.jsx, which
 * writes it on login and clears it on logout).
 *
 * Every RPC in allocations.js/management.js/authApi.js that mutates data
 * now requires this token as its first parameter (see supabase/schema.sql
 * — require_session/require_permission validate it server-side before any
 * write happens). Reading it here directly, instead of threading it through
 * every component that calls a db function, keeps the blast radius of this
 * change to the db/ layer only — no component code needs to change.
 */
export const SESSION_TOKEN_KEY = 'cas_session_token';

export function getSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}
