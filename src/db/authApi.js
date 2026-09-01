/**
 * src/db/authApi.js — Supabase-backed replacement for the old localStorage
 * mock that used to live in src/auth/mockDb.js. Every call is a
 * security-definer RPC (see
 * supabase/schema.sql) — the app never reads/writes app_users/app_sessions
 * directly, only through these controlled functions.
 */
import { supabase } from './supabaseClient.js';
import { getSessionToken } from './sessionToken.js';

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
  const rows = await unwrap(supabase.rpc('list_app_users', { p_token: getSessionToken() }));
  return rows.map(mapUser);
}

export async function getUserById(id) {
  const users = await getUsers();
  return users.find(u => u.id === id) || null;
}

// Autoatendimento: lê os dados do PRÓPRIO usuário logado (whoami), sem
// exigir nenhuma permissão de gerenciamento — ao contrário de getUsers()/
// getUserById() (que passam por list_app_users, gated por
// CREATE_ANY_USER/EDIT_ANY_USER/etc.). É o que AuthContext.refreshUser()
// usa, já que qualquer usuário logado pode acabar precisando recarregar o
// próprio perfil (ex. depois de trocar o nome), não só quem tem permissão
// de gerenciar outras contas.
export async function getOwnUser() {
  const rows = await unwrap(supabase.rpc('whoami', { p_token: getSessionToken() }));
  return rows.length ? mapUser(rows[0]) : null;
}

// p_created_by não é mais mandado pelo cliente — a função no banco agora
// deriva "quem criou" do próprio token de sessão (ver create_app_user em
// supabase/schema.sql), então não dá mais pra um cliente se declarar
// "criado por" outra pessoa.
export async function createUser(data) {
  const rows = await unwrap(supabase.rpc('create_app_user', {
    p_token: getSessionToken(),
    p_username: data.username, p_name: data.name, p_email: data.email,
    p_password: data.password, p_role_id: data.roleId,
  }));
  return mapUser(rows[0]);
}

export async function updateUser(id, updates) {
  const rows = await unwrap(supabase.rpc('update_app_user', {
    p_token: getSessionToken(),
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
  const rows = await unwrap(supabase.rpc('deactivate_app_user', { p_token: getSessionToken(), p_id: id }));
  return mapUser(rows[0]);
}

export async function deleteUser(id) {
  await unwrap(supabase.rpc('delete_app_user', { p_token: getSessionToken(), p_id: id }));
}

// Login/validação/revogação de sessão não levam p_token — são o próprio
// mecanismo que emite/confere/apaga o token, não uma ação autenticada por
// ele (ver comentário equivalente em supabase/schema.sql).
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

// Autoatendimento — qualquer usuário logado troca a PRÓPRIA senha (não
// depende de EDIT_ANY_USER, ao contrário de updateUser). A função no banco
// (change_own_password) confere a senha atual antes de aceitar a nova.
export async function changeOwnPassword(currentPassword, newPassword) {
  const { error } = await supabase.rpc('change_own_password', {
    p_token: getSessionToken(), p_current_password: currentPassword, p_new_password: newPassword,
  });
  if (error) throw error;
}

// Autoatendimento: qualquer usuário logado troca o próprio nome — outros
// campos (usuário, e-mail, função) continuam exigindo EDIT_ANY_USER e
// passam pela Diretoria (ver src/components/ProfileScreen.jsx).
export async function changeOwnName(name) {
  const { error } = await supabase.rpc('change_own_name', { p_token: getSessionToken(), p_name: name });
  if (error) throw error;
}
