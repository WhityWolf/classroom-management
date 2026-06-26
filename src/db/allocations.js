/**
 * src/db/allocations.js — Supabase-backed replacement for the old in-memory
 * + localStorage state in classroom-allocation.jsx. Mirrors the small
 * exported-functions convention also used by src/db/authApi.js and
 * src/db/management.js.
 */
import { supabase } from './supabaseClient.js';

export const mapRoom = r => ({
  id: r.id, roleId: r.role_id, blockId: r.block_id, label: r.label, cap: r.cap, type: r.type,
  features: r.features, floor: r.floor, desc: r.description,
});
// '2026.1' fallback mirrors DEFAULT_PERIOD in classroom-allocation.jsx —
// only hit if the `period` migration hasn't run yet on this Supabase project
// (column missing from the row). Without it, comparePeriods()'s `.split('.')`
// would throw on `undefined` and crash the whole app, not just degrade.
export const mapCourse = c => ({
  id: c.id, code: c.code, name: c.name, sec: c.sec, roleId: c.role_id, period: c.period ?? '2026.1',
  teacher: c.teacher, blocks: c.blocks, enroll: c.enroll, roomByDay: c.room_by_day ?? {},
});
export const mapNotification = n => ({
  id: n.id, roleId: n.role_id, roleName: n.role_name, type: n.type,
  userName: n.user_name, timestamp: n.created_at, read: n.read,
});

async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchAll() {
  const [subUnitRows, roleRows, blockRows, rooms, courses, statusRows, notifRows, featureRows] = await Promise.all([
    unwrap(supabase.from('sub_units').select('*').order('name')),
    unwrap(supabase.from('roles').select('*').order('name')),
    unwrap(supabase.from('blocks').select('*').order('local').order('name')),
    unwrap(supabase.from('rooms').select('*')),
    unwrap(supabase.from('courses').select('*')),
    unwrap(supabase.from('coordination_statuses').select('*')),
    unwrap(supabase.from('notifications').select('*').order('id')),
    unwrap(supabase.from('room_features').select('*').order('name')),
  ]);
  return {
    subUnits: subUnitRows.map(s => ({
      id: s.id, name: s.name, fullName: s.full_name,
      clr: s.clr, textClr: s.text_clr, bg: s.bg, lightBg: s.light_bg,
    })),
    roles: roleRows.map(r => ({
      id: r.id, subUnitId: r.sub_unit_id, name: r.name,
      permissions: r.permissions || [], isSystem: r.is_system,
    })),
    blocks: blockRows.map(b => ({ id: b.id, local: b.local, name: b.name })),
    rooms: rooms.map(mapRoom),
    courses: courses.map(mapCourse),
    coordinationStatuses: Object.fromEntries(statusRows.map(r => [r.role_id, r.status])),
    notifications: notifRows.map(mapNotification),
    featureOptions: featureRows.map(r => r.name),
  };
}

// Substitui o mapa dia→sala inteiro (não dá um patch parcial por dia) — quem
// chama já monta o objeto final combinando o que quer manter/mudar/remover,
// já que isso depende do curso inteiro (blocks, dias já alocados etc.), não
// só do banco. Cobre tanto "alocar todos os dias na mesma sala" (ListView)
// quanto "alocar/desalocar um dia específico" (Grade) — ver tryAllocate /
// deallocate em Dashboard.
export async function setCourseRoomByDay(courseId, roomByDay) {
  await unwrap(supabase.from('courses').update({ room_by_day: roomByDay }).eq('id', courseId));
}

export async function editCourse(courseId, changes) {
  const patch = {};
  if (changes.code !== undefined) patch.code = changes.code;
  if (changes.sec !== undefined) patch.sec = changes.sec;
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.teacher !== undefined) patch.teacher = changes.teacher;
  if (changes.blocks !== undefined) patch.blocks = changes.blocks;
  if (changes.enroll !== undefined) patch.enroll = changes.enroll;
  if (changes.roomByDay !== undefined) patch.room_by_day = changes.roomByDay;
  await unwrap(supabase.from('courses').update(patch).eq('id', courseId));
}

export async function createCourse(course) {
  await unwrap(supabase.from('courses').insert({
    id: course.id, code: course.code, name: course.name, sec: course.sec,
    role_id: course.roleId, period: course.period, teacher: course.teacher, blocks: course.blocks,
    enroll: course.enroll, room_by_day: {},
  }));
}

// Destructive, but only within `period` — deletes existing rows for
// role_id+period (allocated or not), then bulk-inserts the new set. Past
// periods are read-only in the UI and never reach this function, but the
// scoping lives here too so a bug upstream can't wipe another period's
// history. Not transactional — known/accepted limitation for this
// prototype stage. If insert fails after delete succeeds, the role+period
// is left empty; the import modal keeps parsed rows in state so retrying
// doesn't require re-uploading the file.
export async function replaceRoleCourses(roleId, period, courses) {
  await unwrap(supabase.from('courses').delete().eq('role_id', roleId).eq('period', period));
  if (courses.length === 0) return;
  await unwrap(supabase.from('courses').insert(courses.map(c => ({
    id: c.id, code: c.code, name: c.name, sec: c.sec, role_id: roleId, period,
    teacher: c.teacher, blocks: c.blocks, enroll: c.enroll, room_by_day: {},
  }))));
}

export async function saveRoomFeatures(roomId, features, description) {
  await unwrap(supabase.from('rooms').update({ features, description }).eq('id', roomId));
}

export async function addFeatureOption(name) {
  await unwrap(supabase.from('room_features').insert({ name }));
}

export async function removeFeatureOption(name) {
  await unwrap(supabase.from('room_features').delete().eq('name', name));
}

// Individual updates run concurrently rather than a single upsert: an upsert
// would require every NOT NULL column in the payload (these course rows
// already exist — only `room_by_day` changes), so per-row updates are
// simpler here. autoAllocate (classroom-allocation.jsx) only ever proposes
// one room for a course's *entire* week — it doesn't attempt the
// different-room-per-day split, so every scheduled day maps to that room.
export async function applyAllocations(assignments) {
  await Promise.all(assignments.map(({ course, room }) => {
    const days = [...new Set(course.blocks.flatMap(b => b.days))];
    const roomByDay = Object.fromEntries(days.map(d => [d, room.id]));
    return unwrap(supabase.from('courses').update({ room_by_day: roomByDay }).eq('id', course.id));
  }));
}

export async function finishCoordination(roleId, roleName, userName) {
  await unwrap(supabase.from('coordination_statuses').update({ status: 'finished' }).eq('role_id', roleId));
  await unwrap(supabase.from('notifications').insert({
    role_id: roleId, role_name: roleName, type: 'FINISHED', user_name: userName,
  }));
}

export async function setCoordinationStatus(roleId, status) {
  await unwrap(supabase.from('coordination_statuses').update({ status }).eq('role_id', roleId));
}

export async function markAllNotificationsRead() {
  await unwrap(supabase.from('notifications').update({ read: true }).eq('read', false));
}
