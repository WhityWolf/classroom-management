/**
 * auth/utils.js — date formatting helpers for the user-management UI.
 * Password hashing, token generation and session TTL now live in Postgres
 * (supabase/schema.sql: pgcrypto + the app_users/app_sessions functions) —
 * the client never sees a raw hash or generates its own token.
 */

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
