/**
 * src/db/allocations.js — Supabase-backed replacement for the old in-memory
 * + localStorage state in classroom-allocation.jsx. Mirrors the small
 * exported-functions convention also used by src/db/authApi.js and
 * src/db/management.js.
 *
 * Reads (fetchAll) still go straight to the tables (RLS allows `select` for
 * anon — see supabase/schema.sql). Every mutation instead calls a
 * security-definer RPC that validates the session token (getSessionToken(),
 * read from localStorage — see sessionToken.js) and the right
 * permission/ownership/lock rule server-side before writing; direct
 * INSERT/UPDATE/DELETE from anon on these tables is revoked in schema.sql,
 * so the RPC is the only way in.
 */
import { supabase } from './supabaseClient.js';
import { getSessionToken } from './sessionToken.js';

export const mapRoom = r => ({
  id: r.id, roleId: r.role_id, blockId: r.block_id, label: r.label, cap: r.cap, type: r.type,
  features: r.features, floor: r.floor, desc: r.description, isActive: r.is_active,
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

async function call(fn, params) {
  const { data, error } = await supabase.rpc(fn, { p_token: getSessionToken(), ...params });
  if (error) throw error;
  return data;
}

export async function fetchAll() {
  const [subUnitRows, roleRows, blockRows, rooms, courses, statusRows, notifRows, featureRows, settingsRows, periodRows] = await Promise.all([
    unwrap(supabase.from('sub_units').select('*').order('name')),
    unwrap(supabase.from('roles').select('*').order('name')),
    unwrap(supabase.from('blocks').select('*').order('local').order('name')),
    unwrap(supabase.from('rooms').select('*')),
    unwrap(supabase.from('courses').select('*')),
    unwrap(supabase.from('coordination_statuses').select('*')),
    unwrap(supabase.from('notifications').select('*').order('id')),
    unwrap(supabase.from('room_features').select('*').order('name')),
    unwrap(supabase.from('app_settings').select('*').eq('id', 'singleton')),
    unwrap(supabase.from('periods').select('*')),
  ]);
  return {
    subUnits: subUnitRows.map(s => ({
      id: s.id, name: s.name, fullName: s.full_name,
      clr: s.clr, textClr: s.text_clr, bg: s.bg, lightBg: s.light_bg, isActive: s.is_active,
    })),
    roles: roleRows.map(r => ({
      id: r.id, subUnitId: r.sub_unit_id, name: r.name,
      permissions: r.permissions || [], isSystem: r.is_system,
    })),
    blocks: blockRows.map(b => ({ id: b.id, local: b.local, name: b.name, mapX: b.map_x, mapY: b.map_y, isActive: b.is_active })),
    rooms: rooms.map(mapRoom),
    courses: courses.map(mapCourse),
    coordinationStatuses: Object.fromEntries(statusRows.map(r => [r.role_id, r.status])),
    notifications: notifRows.map(mapNotification),
    featureOptions: featureRows.map(r => r.name),
    currentPeriodOverride: settingsRows[0]?.current_period_override ?? null,
    // Períodos persistidos em si (tabela periods) — existem independente de
    // ter alguma disciplina cadastrada. Quem consome isto normalmente une
    // com os períodos distintos já presentes em `courses` (dados legados
    // podem ter um period que ainda não tenha uma linha correspondente aqui).
    periods: periodRows.map(p => p.id),
  };
}

// Substitui o mapa dia→sala inteiro (não dá um patch parcial por dia) — quem
// chama já monta o objeto final combinando o que quer manter/mudar/remover,
// já que isso depende do curso inteiro (blocks, dias já alocados etc.), não
// só do banco. Cobre tanto "alocar todos os dias na mesma sala" (ListView)
// quanto "alocar/desalocar um dia específico" (Grade) — ver tryAllocate /
// deallocate em Dashboard. Qualquer função ativa pode alocar QUALQUER
// disciplina em QUALQUER sala — "Alocação Cruzada" é intencional (ver
// require_can_allocate/set_course_room_by_day em schema.sql) — só sessão
// válida + coordenação/período não travados, sem checagem de dono.
export async function setCourseRoomByDay(courseId, roomByDay) {
  await call('set_course_room_by_day', { p_course_id: courseId, p_room_by_day: roomByDay });
}

// Só a própria função dona da disciplina (ou institucional) pode editar —
// ver edit_course em schema.sql, que lê o role_id já gravado na disciplina
// antes de aplicar qualquer mudança.
export async function editCourse(courseId, changes) {
  await call('edit_course', {
    p_id: courseId,
    p_code: changes.code ?? null,
    p_sec: changes.sec ?? null,
    p_name: changes.name ?? null,
    p_teacher: changes.teacher ?? null,
    p_blocks: changes.blocks ?? null,
    p_enroll: changes.enroll ?? null,
    p_room_by_day: changes.roomByDay ?? null,
  });
}

export async function deleteCourse(courseId) {
  await call('delete_course', { p_id: courseId });
}

// Institucional pode criar pra qualquer função; não-institucional só pra si
// mesma — ver create_course em schema.sql (antes disso era só a UI que
// nunca oferecia a opção de escolher outra função; um cliente malicioso
// podia mandar um role_id alheio direto pra tabela).
export async function createCourse(course) {
  await call('create_course', {
    p_id: course.id, p_code: course.code, p_name: course.name, p_sec: course.sec,
    p_role_id: course.roleId, p_period: course.period, p_teacher: course.teacher,
    p_blocks: course.blocks, p_enroll: course.enroll,
  });
}

// Destructive, but only within `period` — deletes existing rows for
// role_id+period (allocated or not), then bulk-inserts the new set. Past
// periods are read-only in the UI and never reach this function, but the
// scoping lives here too so a bug upstream can't wipe another period's
// history. Agora atômica (replace_role_courses, ver schema.sql): se o
// insert falhar depois do delete, a transação inteira desfaz — o
// role+period nunca fica vazio por um erro no meio do caminho (diferente
// da versão anterior em duas chamadas separadas do cliente).
export async function replaceRoleCourses(roleId, period, courses) {
  await call('replace_role_courses', {
    p_role_id: roleId, p_period: period,
    p_courses: courses.map(c => ({
      id: c.id, code: c.code, name: c.name, sec: c.sec, teacher: c.teacher, blocks: c.blocks, enroll: c.enroll,
    })),
  });
}

export async function saveRoomFeatures(roomId, features, description) {
  await call('save_room_features', { p_room_id: roomId, p_features: features, p_description: description });
}

export async function addFeatureOption(name) {
  await call('add_feature_option', { p_name: name });
}

export async function removeFeatureOption(name) {
  await call('remove_feature_option', { p_name: name });
}

// autoAllocate (classroom-allocation.jsx) só propõe uma sala pra semana
// inteira de uma disciplina — não tenta o "sala diferente por dia". A
// função no banco (apply_allocations) aplica cada atribuição na mesma
// transação, checando require_can_allocate por disciplina.
export async function applyAllocations(assignments) {
  const items = assignments.map(({ course, room }) => {
    const days = [...new Set(course.blocks.flatMap(b => b.days))];
    return { course_id: course.id, room_by_day: Object.fromEntries(days.map(d => [d, room.id])) };
  });
  await call('apply_allocations', { p_assignments: items });
}

// Sem parâmetros: opera sobre a PRÓPRIA função de quem chama, derivada do
// token de sessão — nome da função e nome do usuário (usados na
// notificação da Diretoria) também vêm do servidor agora, não do cliente
// (ver finish_coordination em schema.sql).
export async function finishCoordination() {
  await call('finish_coordination', {});
}

// Reabrir/bloquear a coordenação de QUALQUER função — só institucional com
// MANAGE_COORDINATION_STATUS.
export async function setCoordinationStatus(roleId, status) {
  await call('set_coordination_status', { p_role_id: roleId, p_status: status });
}

export async function markAllNotificationsRead() {
  await call('mark_all_notifications_read', {});
}

// period=null volta ao comportamento automático (maior período por
// comparePeriods); um valor força esse período como "atual" pra todo mundo,
// via a linha singleton de app_settings. Só institucional.
export async function setCurrentPeriodOverride(period) {
  await call('set_current_period_override', { p_period: period });
}