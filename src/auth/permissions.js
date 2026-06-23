/**
 * auth/permissions.js — Permission identifiers (capabilities the UI checks
 * for). The set of permissions a given user has is no longer a static
 * lookup keyed by a fixed role enum — it comes from `role.permissions`
 * (the `roles` table, loaded dynamically — see src/db/management.js).
 */

export const PERMS = Object.freeze({
  // Courses
  VIEW_OWN_COURSES: 'VIEW_OWN_COURSES',
  VIEW_ALL_COURSES: 'VIEW_ALL_COURSES',
  EDIT_COURSES:      'EDIT_COURSES',

  // Rooms
  VIEW_ALL_ROOMS:        'VIEW_ALL_ROOMS',
  EDIT_ROOM_DESCRIPTION: 'EDIT_ROOM_DESCRIPTION',

  // Allocations
  ALLOCATE_OWN_ROOMS:   'ALLOCATE_OWN_ROOMS',
  ALLOCATE_ALL_ROOMS:   'ALLOCATE_ALL_ROOMS',
  DEALLOCATE_OWN_ROOMS: 'DEALLOCATE_OWN_ROOMS',
  DEALLOCATE_ALL_ROOMS: 'DEALLOCATE_ALL_ROOMS',
  MERGE_GROUPS:         'MERGE_GROUPS',

  // Workflow
  FINISH_ALLOCATION:          'FINISH_ALLOCATION',         // coordination submits its work
  MANAGE_COORDINATION_STATUS: 'MANAGE_COORDINATION_STATUS', // institutional: reopen / force-finish

  // Users
  VIEW_USERS:      'VIEW_USERS',
  CREATE_ANY_USER: 'CREATE_ANY_USER',
  EDIT_ANY_USER:   'EDIT_ANY_USER',
  DEACTIVATE_USER: 'DEACTIVATE_USER',
  ASSIGN_ROLES:    'ASSIGN_ROLES',

  // Management screen (institutional roles only)
  MANAGE_SUB_UNITS: 'MANAGE_SUB_UNITS',
  MANAGE_ROLES:     'MANAGE_ROLES',
  MANAGE_ROOMS:     'MANAGE_ROOMS',
  MANAGE_BLOCKS:    'MANAGE_BLOCKS',
});

/**
 * @param {{permissions?: string[]}|null} role  – the loaded role object (currentUser.role)
 * @param {string} perm
 * @returns {boolean}
 */
export function hasPermission(role, perm) {
  return !!role && Array.isArray(role.permissions) && role.permissions.includes(perm);
}

export function getPermissionsForRole(role) {
  return role?.permissions ? [...role.permissions] : [];
}
