/**
 * auth/permissions.js
 * Granular permission constants and role → permission mappings.
 *
 * Naming convention:
 *   VIEW_*        – read access
 *   CREATE_*      – creation
 *   EDIT_*        – mutation
 *   DELETE_*      – removal
 *   *_OWN_DEPT    – scoped to the user's own department
 *   *_ALL_*       – cross-department / institution-wide
 */

export const PERMS = Object.freeze({
  // ── Courses ──────────────────────────────────────────────────────────────
  VIEW_OWN_DEPT_COURSES:   'VIEW_OWN_DEPT_COURSES',
  VIEW_ALL_COURSES:        'VIEW_ALL_COURSES',
  CREATE_COURSE:           'CREATE_COURSE',
  EDIT_OWN_DEPT_COURSES:   'EDIT_OWN_DEPT_COURSES',
  EDIT_ALL_COURSES:        'EDIT_ALL_COURSES',
  DELETE_OWN_DEPT_COURSE:  'DELETE_OWN_DEPT_COURSE',
  DELETE_ANY_COURSE:       'DELETE_ANY_COURSE',

  // ── Rooms ─────────────────────────────────────────────────────────────────
  VIEW_OWN_DEPT_ROOMS:   'VIEW_OWN_DEPT_ROOMS',
  VIEW_ALL_ROOMS:        'VIEW_ALL_ROOMS',
  EDIT_OWN_DEPT_ROOMS:   'EDIT_OWN_DEPT_ROOMS',
  EDIT_ALL_ROOMS:        'EDIT_ALL_ROOMS',
  EDIT_ROOM_DESCRIPTION: 'EDIT_ROOM_DESCRIPTION',

  // ── Allocations ───────────────────────────────────────────────────────────
  ALLOCATE_OWN_DEPT:           'ALLOCATE_OWN_DEPT',
  ALLOCATE_ALL_DEPTS:          'ALLOCATE_ALL_DEPTS',
  DEALLOCATE_OWN_DEPT:         'DEALLOCATE_OWN_DEPT',
  DEALLOCATE_ALL_DEPTS:        'DEALLOCATE_ALL_DEPTS',
  REQUEST_CROSS_DEPT_ROOM:     'REQUEST_CROSS_DEPT_ROOM',
  APPROVE_CROSS_DEPT_REQUEST:  'APPROVE_CROSS_DEPT_REQUEST',
  MERGE_GROUPS:                'MERGE_GROUPS',

  // ── Users ─────────────────────────────────────────────────────────────────
  VIEW_USERS:            'VIEW_USERS',
  CREATE_OWN_DEPT_USER:  'CREATE_OWN_DEPT_USER',
  CREATE_ANY_USER:       'CREATE_ANY_USER',
  EDIT_OWN_DEPT_USER:    'EDIT_OWN_DEPT_USER',
  EDIT_ANY_USER:         'EDIT_ANY_USER',
  DEACTIVATE_USER:       'DEACTIVATE_USER',
  ASSIGN_ROLES:          'ASSIGN_ROLES',

  // ── Reports ───────────────────────────────────────────────────────────────
  VIEW_OWN_DEPT_REPORTS: 'VIEW_OWN_DEPT_REPORTS',
  VIEW_ALL_REPORTS:      'VIEW_ALL_REPORTS',
});

const P = PERMS; // shorthand alias

/**
 * The complete set of permissions granted to each role.
 *
 * Design note: permissions are explicit (no inheritance chain).
 * This makes audit trivial — you can read exactly what each role can do.
 */
export const ROLE_PERMISSIONS = Object.freeze({

  FACULTY: [
    P.VIEW_OWN_DEPT_COURSES,
    P.VIEW_OWN_DEPT_ROOMS,
    P.VIEW_OWN_DEPT_REPORTS,
  ],

  DEPT_COORDINATOR: [
    P.VIEW_OWN_DEPT_COURSES,
    P.VIEW_ALL_COURSES,
    P.VIEW_OWN_DEPT_ROOMS,
    P.VIEW_ALL_ROOMS,
    P.ALLOCATE_OWN_DEPT,
    P.DEALLOCATE_OWN_DEPT,
    P.REQUEST_CROSS_DEPT_ROOM,
    P.EDIT_ROOM_DESCRIPTION,
    P.MERGE_GROUPS,
    P.VIEW_OWN_DEPT_REPORTS,
  ],

  DEPT_HEAD: [
    P.VIEW_OWN_DEPT_COURSES,
    P.VIEW_ALL_COURSES,
    P.CREATE_COURSE,
    P.EDIT_OWN_DEPT_COURSES,
    P.DELETE_OWN_DEPT_COURSE,
    P.VIEW_OWN_DEPT_ROOMS,
    P.VIEW_ALL_ROOMS,
    P.EDIT_OWN_DEPT_ROOMS,
    P.ALLOCATE_OWN_DEPT,
    P.DEALLOCATE_OWN_DEPT,
    P.REQUEST_CROSS_DEPT_ROOM,
    P.EDIT_ROOM_DESCRIPTION,
    P.MERGE_GROUPS,
    P.VIEW_USERS,
    P.CREATE_OWN_DEPT_USER,
    P.EDIT_OWN_DEPT_USER,
    P.VIEW_OWN_DEPT_REPORTS,
    P.VIEW_ALL_REPORTS,
  ],

  DIRECTOR: [
    P.VIEW_OWN_DEPT_COURSES,
    P.VIEW_ALL_COURSES,
    P.CREATE_COURSE,
    P.EDIT_OWN_DEPT_COURSES,
    P.EDIT_ALL_COURSES,
    P.DELETE_OWN_DEPT_COURSE,
    P.DELETE_ANY_COURSE,
    P.VIEW_OWN_DEPT_ROOMS,
    P.VIEW_ALL_ROOMS,
    P.EDIT_OWN_DEPT_ROOMS,
    P.EDIT_ALL_ROOMS,
    P.EDIT_ROOM_DESCRIPTION,
    P.ALLOCATE_OWN_DEPT,
    P.ALLOCATE_ALL_DEPTS,
    P.DEALLOCATE_OWN_DEPT,
    P.DEALLOCATE_ALL_DEPTS,
    P.REQUEST_CROSS_DEPT_ROOM,
    P.APPROVE_CROSS_DEPT_REQUEST,
    P.MERGE_GROUPS,
    P.VIEW_USERS,           // can view, but NOT create/edit users (that's SYSTEM_ADMIN)
    P.VIEW_OWN_DEPT_REPORTS,
    P.VIEW_ALL_REPORTS,
  ],

  SYSTEM_ADMIN: Object.values(PERMS), // unrestricted
});

/**
 * Returns true if `role` holds `perm`.
 * @param {string} role  – one of ROLES constants
 * @param {string} perm  – one of PERMS constants
 * @returns {boolean}
 */
export function hasPermission(role, perm) {
  return (ROLE_PERMISSIONS[role] || []).includes(perm);
}

/**
 * Returns the full permission set for a role.
 * @param {string} role
 * @returns {string[]}
 */
export function getPermissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[role] || [])];
}
