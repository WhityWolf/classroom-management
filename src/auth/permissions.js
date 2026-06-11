/**
 * auth/permissions.js — Permissions for the two-tier role system.
 */

export const PERMS = Object.freeze({
  // Courses
  VIEW_OWN_DEPT_COURSES: 'VIEW_OWN_DEPT_COURSES',
  VIEW_ALL_COURSES:      'VIEW_ALL_COURSES',
  EDIT_COURSES:          'EDIT_COURSES',

  // Rooms
  VIEW_ALL_ROOMS:        'VIEW_ALL_ROOMS',
  EDIT_ROOM_DESCRIPTION: 'EDIT_ROOM_DESCRIPTION', // CHIEF only

  // Allocations
  ALLOCATE_OWN_DEPT:    'ALLOCATE_OWN_DEPT',
  ALLOCATE_ALL_DEPTS:   'ALLOCATE_ALL_DEPTS',     // CHIEF only
  DEALLOCATE_OWN_DEPT:  'DEALLOCATE_OWN_DEPT',
  DEALLOCATE_ALL_DEPTS: 'DEALLOCATE_ALL_DEPTS',   // CHIEF only
  MERGE_GROUPS:         'MERGE_GROUPS',

  // Workflow
  FINISH_ALLOCATION:  'FINISH_ALLOCATION',   // dept head submits their work
  MANAGE_DEPT_STATUS: 'MANAGE_DEPT_STATUS',  // chief reopens / force-finishes

  // Users
  VIEW_USERS:      'VIEW_USERS',
  CREATE_ANY_USER: 'CREATE_ANY_USER',
  EDIT_ANY_USER:   'EDIT_ANY_USER',
  DEACTIVATE_USER: 'DEACTIVATE_USER',
  ASSIGN_ROLES:    'ASSIGN_ROLES',
});

const P = PERMS;

export const ROLE_PERMISSIONS = Object.freeze({
  DEPT_HEAD: [
    P.VIEW_OWN_DEPT_COURSES,
    P.EDIT_COURSES,
    P.ALLOCATE_OWN_DEPT,
    P.DEALLOCATE_OWN_DEPT,
    P.MERGE_GROUPS,
    P.FINISH_ALLOCATION,
  ],
  CHIEF: Object.values(PERMS),
});

export function hasPermission(role, perm) {
  return (ROLE_PERMISSIONS[role] || []).includes(perm);
}

export function getPermissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[role] || [])];
}