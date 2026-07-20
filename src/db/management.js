/**
 * src/db/management.js — sub_units / roles / blocks read+write access.
 * Same one-function-per-call convention as allocations.js/authApi.js.
 */
import { supabase } from './supabaseClient.js';

export const mapSubUnit = s => ({
  id: s.id, name: s.name, fullName: s.full_name,
  clr: s.clr, textClr: s.text_clr, bg: s.bg, lightBg: s.light_bg,
});
export const mapRole = r => ({
  id: r.id, subUnitId: r.sub_unit_id, name: r.name,
  permissions: r.permissions || [], isSystem: r.is_system,
});
export const mapBlock = b => ({ id: b.id, local: b.local, name: b.name });

async function unwrap(query) {
  const { data, error } = await query;
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

export async function createSubUnit(subUnit) {
  await unwrap(supabase.from('sub_units').insert({
    id: subUnit.id, name: subUnit.name, full_name: subUnit.fullName,
    clr: subUnit.clr, text_clr: subUnit.textClr, bg: subUnit.bg, light_bg: subUnit.lightBg,
  }));
}

export async function updateSubUnit(id, changes) {
  const patch = {};
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.fullName !== undefined) patch.full_name = changes.fullName;
  if (changes.clr !== undefined) patch.clr = changes.clr;
  if (changes.textClr !== undefined) patch.text_clr = changes.textClr;
  if (changes.bg !== undefined) patch.bg = changes.bg;
  if (changes.lightBg !== undefined) patch.light_bg = changes.lightBg;
  await unwrap(supabase.from('sub_units').update(patch).eq('id', id));
}

export async function deleteSubUnit(id) {
  await unwrap(supabase.from('sub_units').delete().eq('id', id));
}

export async function createRole(role) {
  await unwrap(supabase.from('roles').insert({
    id: role.id, sub_unit_id: role.subUnitId, name: role.name, permissions: role.permissions,
  }));
}

export async function updateRole(id, changes) {
  const patch = {};
  if (changes.subUnitId !== undefined) patch.sub_unit_id = changes.subUnitId;
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.permissions !== undefined) patch.permissions = changes.permissions;
  await unwrap(supabase.from('roles').update(patch).eq('id', id));
}

export async function countRoleCourses(id) {
  const { count, error } = await supabase.from('courses').select('id', { count:'exact', head:true }).eq('role_id', id);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteRole(id) {
  await unwrap(supabase.from('roles').delete().eq('id', id));
}

// Atômica (função Postgres security definer, ver supabase/schema.sql) — se
// a função ainda tiver salas/usuários vinculados, a FK restrict rejeita o
// delete de roles e o Postgres desfaz o delete de courses junto, em vez de
// deixar as disciplinas apagadas com a função presa.
export async function deleteRoleAndCourses(id) {
  const { error } = await supabase.rpc('delete_role_and_courses', { p_id: id });
  if (error) throw error;
}

export async function createBlock(block) {
  await unwrap(supabase.from('blocks').insert({ id: block.id, local: block.local, name: block.name }));
}

export async function updateBlock(id, changes) {
  const patch = {};
  if (changes.local !== undefined) patch.local = changes.local;
  if (changes.name !== undefined) patch.name = changes.name;
  await unwrap(supabase.from('blocks').update(patch).eq('id', id));
}

export async function deleteBlock(id) {
  await unwrap(supabase.from('blocks').delete().eq('id', id));
}

export async function createRoom(room) {
  await unwrap(supabase.from('rooms').insert({
    id: room.id, role_id: room.roleId, block_id: room.blockId, label: room.label,
    cap: room.cap, type: room.type, floor: room.floor,
    features: room.features || [], description: room.description || '',
  }));
}

export async function updateRoom(id, changes) {
  const patch = {};
  if (changes.roleId !== undefined) patch.role_id = changes.roleId;
  if (changes.blockId !== undefined) patch.block_id = changes.blockId;
  if (changes.label !== undefined) patch.label = changes.label;
  if (changes.cap !== undefined) patch.cap = changes.cap;
  if (changes.type !== undefined) patch.type = changes.type;
  if (changes.floor !== undefined) patch.floor = changes.floor;
  if (changes.features !== undefined) patch.features = changes.features;
  if (changes.description !== undefined) patch.description = changes.description;
  await unwrap(supabase.from('rooms').update(patch).eq('id', id));
}

export async function deleteRoom(id) {
  await unwrap(supabase.from('rooms').delete().eq('id', id));
}

// Atômica (função Postgres security definer, ver supabase/schema.sql) —
// limpa as referências a esta sala em courses.room_by_day (jsonb, sem FK
// real pra rooms) e apaga a sala numa única transação no banco, em vez de
// duas chamadas separadas do cliente. `affectedCourses` não é mais
// necessário pra mutação em si (a função já resolve isso sozinha no
// servidor) — só a contagem prévia pra mostrar na confirmação continua
// sendo calculada no cliente a partir de `courses` já carregado. Retorna
// quantas disciplinas foram desalocadas.
export async function deleteRoomAndUnallocate(id) {
  const { data, error } = await supabase.rpc('delete_room_and_unallocate', { p_id: id });
  if (error) throw error;
  return data ?? 0;
}

// ─── Períodos letivos ─────────────────────────────────────────────────────────
export async function createPeriod(id) {
  await unwrap(supabase.from('periods').insert({ id }));
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
// está sendo removido, pra não deixar o "período atual" fixado pendurado
// numa referência inexistente.
export async function deletePeriodAndCourses(id) {
  const { error } = await supabase.rpc('delete_period_and_courses', { p_id: id });
  if (error) throw error;
}
