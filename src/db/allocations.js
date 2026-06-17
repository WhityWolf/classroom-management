/**
 * src/db/allocations.js — Supabase-backed replacement for the old in-memory
 * + localStorage state in classroom-allocation.jsx. Mirrors the small
 * exported-functions convention used by src/auth/mockDb.js.
 */
import { supabase } from './supabaseClient.js';

export const mapRoom = r => ({
  id: r.id, deptId: r.dept_id, label: r.label, cap: r.cap, type: r.type,
  features: r.features, building: r.building, floor: r.floor, desc: r.description,
});
export const mapCourse = c => ({
  id: c.id, code: c.code, name: c.name, sec: c.sec, deptId: c.dept_id,
  blocks: c.blocks, enroll: c.enroll, room: c.room,
});
export const mapNotification = n => ({
  id: n.id, deptId: n.dept_id, deptName: n.dept_name, type: n.type,
  userName: n.user_name, timestamp: n.created_at, read: n.read,
});

async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchAll() {
  const [rooms, courses, deptStatusRows, notifRows, featureRows] = await Promise.all([
    unwrap(supabase.from('rooms').select('*')),
    unwrap(supabase.from('courses').select('*')),
    unwrap(supabase.from('dept_statuses').select('*')),
    unwrap(supabase.from('notifications').select('*').order('id')),
    unwrap(supabase.from('room_features').select('*').order('name')),
  ]);
  return {
    rooms: rooms.map(mapRoom),
    courses: courses.map(mapCourse),
    deptStatuses: Object.fromEntries(deptStatusRows.map(r => [r.dept_id, r.status])),
    notifications: notifRows.map(mapNotification),
    featureOptions: featureRows.map(r => r.name),
  };
}

export async function allocateCourse(courseId, roomId) {
  await unwrap(supabase.from('courses').update({ room: roomId }).eq('id', courseId));
}

export async function deallocateCourse(courseId) {
  await unwrap(supabase.from('courses').update({ room: null }).eq('id', courseId));
}

export async function editCourse(courseId, changes) {
  const patch = {};
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.blocks !== undefined) patch.blocks = changes.blocks;
  if (changes.enroll !== undefined) patch.enroll = changes.enroll;
  if (changes.room !== undefined) patch.room = changes.room;
  await unwrap(supabase.from('courses').update(patch).eq('id', courseId));
}

export async function createCourse(course) {
  await unwrap(supabase.from('courses').insert({
    id: course.id, code: course.code, name: course.name, sec: course.sec,
    dept_id: course.deptId, blocks: course.blocks,
    enroll: course.enroll, room: null,
  }));
}

// Destructive: deletes every existing row for deptId (allocated or not),
// then bulk-inserts the new set. Not transactional — known/accepted
// limitation for this prototype stage. If insert fails after delete
// succeeds, the dept is left with zero courses; the import modal keeps
// parsed rows in state so retrying doesn't require re-uploading the file.
export async function replaceDeptCourses(deptId, courses) {
  await unwrap(supabase.from('courses').delete().eq('dept_id', deptId));
  if (courses.length === 0) return;
  await unwrap(supabase.from('courses').insert(courses.map(c => ({
    id: c.id, code: c.code, name: c.name, sec: c.sec, dept_id: deptId,
    blocks: c.blocks, enroll: c.enroll, room: null,
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
// already exist — only `room` changes), so per-row updates are simpler here.
export async function applyAllocations(assignments) {
  await Promise.all(assignments.map(({ course, room }) =>
    unwrap(supabase.from('courses').update({ room: room.id }).eq('id', course.id))
  ));
}

export async function finishDept(deptId, deptName, userName) {
  await unwrap(supabase.from('dept_statuses').update({ status: 'finished' }).eq('dept_id', deptId));
  await unwrap(supabase.from('notifications').insert({
    dept_id: deptId, dept_name: deptName, type: 'FINISHED', user_name: userName,
  }));
}

export async function setDeptStatus(deptId, status) {
  await unwrap(supabase.from('dept_statuses').update({ status }).eq('dept_id', deptId));
}

export async function markAllNotificationsRead() {
  await unwrap(supabase.from('notifications').update({ read: true }).eq('read', false));
}
