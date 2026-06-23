/**
 * src/db/authApi.js — Supabase-backed replacement for the old localStorage
 * mock that used to live in src/auth/mockDb.js. Every call is a
 * security-definer RPC (see
 * supabase/schema.sql) — the app never reads/writes app_users/app_sessions
 * directly, only through these controlled functions.
 */
import { supabase } from './supabaseClient.js';

async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const mapUser = (u) => !u ? null : ({
  id: u.id, username: u.username, name: u.name, email: u.email,
  roleId: u.role_id, isActive: u.is_active, createdAt: u.created_at,
  createdBy: u.created_by, lastLogin: u.last_login, updatedAt: u.updated_at,
});

export async function getUsers() {
  const rows = await unwrap(supabase.rpc('list_app_users'));
  return rows.map(mapUser);
}

export async function getUserById(id) {
  const users = await getUsers();
  return users.find(u => u.id === id) || null;
}

export async function createUser(data, createdById) {
  const rows = await unwrap(supabase.rpc('create_app_user', {
    p_username: data.username, p_name: data.name, p_email: data.email,
    p_password: data.password, p_role_id: data.roleId, p_created_by: createdById,
  }));
  return mapUser(rows[0]);
}

export async function updateUser(id, updates) {
  const rows = await unwrap(supabase.rpc('update_app_user', {
    p_id: id,
    p_name: updates.name ?? null,
    p_email: updates.email ?? null,
    p_password: updates.password || null,
    p_role_id: updates.roleId ?? null,
    p_is_active: updates.isActive ?? null,
  }));
  return mapUser(rows[0]);
}

export async function deactivateUser(id) {
  const rows = await unwrap(supabase.rpc('deactivate_app_user', { p_id: id }));
  return mapUser(rows[0]);
}

export async function loginUser(username, password) {
  const rows = await unwrap(supabase.rpc('authenticate_app_user', { p_username: username, p_password: password }));
  if (!rows.length) return null;
  const { token, ...rest } = rows[0];
  return { token, user: mapUser(rest) };
}

export async function validateSession(token) {
  if (!token) return null;
  const rows = await unwrap(supabase.rpc('validate_app_session', { p_token: token }));
  return rows.length ? mapUser(rows[0]) : null;
}

export async function revokeSession(token) {
  await unwrap(supabase.rpc('revoke_app_session', { p_token: token }));
}
