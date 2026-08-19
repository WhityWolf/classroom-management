/**
 * src/db/management.js — sub_units / roles / blocks / rooms / periods read
 * access + mutations. Reads still go straight to the tables (RLS allows
 * `select` for anon — see supabase/schema.sql). Every mutation instead
 * calls a security-definer RPC that validates the session token
 * (getSessionToken(), read from localStorage — see sessionToken.js) and the
 * right permission server-side before writing; direct INSERT/UPDATE/DELETE
 * from anon on these tables is revoked in schema.sql, so the RPC is the
 * only way in. Same one-function-per-call convention as
 * allocations.js/authApi.js.
 */
import { supabase } from './supabaseClient.js';
import { getSessionToken } from './sessionToken.js';

export const mapSubUnit = s => ({
  id: s.id, name: s.name, fullName: s.full_name,
  clr: s.clr, textClr: s.text_clr, bg: s.bg, lightBg: s.light_bg,
});
export const mapRole = r => ({
  id: r.id, subUnitId: r.sub_unit_id, name: r.name,
  permissions: r.permissions || [], isSystem: r.is_system,
});
export const mapBlock = b => ({ id: b.id, local: b.local, name: b.name, mapX: b.map_x, mapY: b.map_y });

async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function call(fn, params) {
  const { data, error } = await supabase.rpc(fn, { p_token: getSessionToken(), ...params });
  if (error) throw error;
  return data;
}

export async function fetchSubUnits() {
  const rows = await unwrap(supabase.from('sub_units').select('*').order('name'));
  return rows.map(mapSubUnit);
}

export async function fetchRoles() {
  const rows = await unwrap(supabase.from('roles').select('*').order('name'));
  return rows.map(mapRole);
}

export async function fetchBlocks() {
  const rows = await unwrap(supabase.from('blocks').select('*').order('local').order('name'));
  return rows.map(mapBlock);
}

export async function fetchRoleById(roleId) {
  if (!roleId) return null;
  const { data, error } = await supabase.from('roles').select('*').eq('id', roleId).maybeSingle();
  if (error) throw error;
  return data ? mapRole(data) : null;
}

// ─── Sub-unidades (MANAGE_SUB_UNITS) ────────────────────────────────────────
export async function createSubUnit(subUnit) {
  await call('create_sub_unit', {
    p_id: subUnit.id, p_name: subUnit.name, p_full_name: subUnit.fullName,
    p_clr: subUnit.clr, p_text_clr: subUnit.textClr, p_bg: subUnit.bg, p_light_bg: subUnit.lightBg,
  });
}

export async function updateSubUnit(id, changes) {
  await call('update_sub_unit', {
    p_id: id,
    p_name: changes.name ?? null, p_full_name: changes.fullName ?? null,
    p_clr: changes.clr ?? null, p_text_clr: changes.textClr ?? null,
    p_bg: changes.bg ?? null, p_light_bg: changes.lightBg ?? null,
  });
}

export async function deleteSubUnit(id) {
  await call('delete_sub_unit', { p_id: id });
}

// ─── Funções (MANAGE_ROLES) ─────────────────────────────────────────────────
export async function createRole(role) {
  await call('create_role', {
    p_id: role.id, p_sub_unit_id: role.subUnitId, p_name: role.name, p_permissions: role.permissions,
  });
}

export async function updateRole(id, changes) {
  await call('update_role', {
    p_id: id,
    // sub_unit_id é o único campo aqui que legitimamente precisa virar NULL
    // (função vira institucional) — daí o flag separado p_clear_sub_unit_id
    // em vez de deduzir "null" a partir de "undefined" (coalesce no servidor
    // trataria null igual a "não mudar", perdendo essa transição).
    p_sub_unit_id: changes.subUnitId ?? null,
    p_clear_sub_unit_id: changes.subUnitId === null,
    p_name: changes.name ?? null,
    p_permissions: changes.permissions ?? null,
  });
}

export async function countRoleCourses(id) {
  const { count, error } = await supabase.from('courses').select('id', { count:'exact', head:true }).eq('role_id', id);
  if (error) throw error;
  return count ?? 0;
}

// Atômica (função Postgres security definer, ver supabase/schema.sql) — se
// a função ainda tiver salas/usuários vinculados, a FK restrict rejeita o
// delete de roles e o Postgres desfaz o delete de courses junto, em vez de
// deixar as disciplinas apagadas com a função presa. Usada tanto no caminho
// "sem disciplinas" quanto no "com disciplinas" do RolesTab — não muda
// nada rodar mesmo quando courseCount é 0.
export async function deleteRoleAndCourses(id) {
  await call('delete_role_and_courses', { p_id: id });
}

// ─── Blocos (MANAGE_BLOCKS) ─────────────────────────────────────────────────
export async function createBlock(block) {
  await call('create_block', { p_id: block.id, p_local: block.local, p_name: block.name });
}

export async function updateBlock(id, changes) {
  await call('update_block', { p_id: id, p_local: changes.local ?? null, p_name: changes.name ?? null });
}

export async function deleteBlock(id) {
  await call('delete_block', { p_id: id });
}

// Posição do pino no Mapa do Campus (0-100, porcentagem da imagem). x/y
// null = "desmarcar" (bloco volta a aparecer como sem posição).
export async function setBlockPosition(id, x, y) {
  await call('set_block_position', { p_id: id, p_x: x, p_y: y });
}

// ─── Salas (MANAGE_ROOMS — update_room também aceita MANAGE_ROLES, porque a
// aba Funções usa esta mesma mutação pra alternar "esta sala pertence a
// este papel") ───────────────────────────────────────────────────────────
export async function createRoom(room) {
  await call('create_room', {
    p_id: room.id, p_role_id: room.roleId ?? null, p_block_id: room.blockId, p_label: room.label,
    p_cap: room.cap, p_type: room.type, p_floor: room.floor,
    p_features: room.features || [], p_description: room.description || '',
  });
}

export async function updateRoom(id, changes) {
  await call('update_room', {
    p_id: id,
    p_role_id: changes.roleId ?? null,
    p_clear_role_id: changes.roleId === null,
    p_block_id: changes.blockId ?? null,
    p_label: changes.label ?? null,
    p_cap: changes.cap ?? null,
    p_type: changes.type ?? null,
    p_floor: changes.floor ?? null,
    p_features: changes.features ?? null,
    p_description: changes.description ?? null,
  });
}

// Atômica (função Postgres security definer, ver supabase/schema.sql) —
// limpa as referências a esta sala em courses.room_by_day (jsonb, sem FK
// real pra rooms) e apaga a sala numa única transação no banco. Retorna
// quantas disciplinas foram desalocadas.
export async function deleteRoomAndUnallocate(id) {
  return (await call('delete_room_and_unallocate', { p_id: id })) ?? 0;
}

// ─── Períodos letivos (institucional — sem PERMS.* dedicado) ────────────────
export async function createPeriod(id) {
  await call('create_period', { p_id: id });
}

export async function countPeriodCourses(period) {
  const { count, error } = await supabase.from('courses').select('id', { count:'exact', head:true }).eq('period', period);
  if (error) throw error;
  return count ?? 0;
}

// Atômica (função Postgres security definer, ver supabase/schema.sql) —
// única forma de remover um período do sistema: apaga o período em si e
// todas as disciplinas cadastradas nele (em qualquer função/sub-unidade)
// numa única transação no banco, e limpa
// app_settings.current_period_override se ele apontava pro período que
// está sendo removido.
export async function deletePeriodAndCourses(id) {
  await call('delete_period_and_courses', { p_id: id });
}