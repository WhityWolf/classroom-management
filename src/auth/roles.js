/**
 * auth/roles.js — Two-tier role hierarchy.
 *
 *   CHIEF     Institution-wide authority. Full access to everything.
 *   DEPT_HEAD Scoped to their own department. Can allocate own rooms only.
 */

export const ROLES = Object.freeze({
  CHIEF:     'CHIEF',
  DEPT_HEAD: 'DEPT_HEAD',
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.CHIEF]:     'Chief (Administrator)',
  [ROLES.DEPT_HEAD]: 'Department Head',
});

export const ROLE_LEVEL = Object.freeze({
  [ROLES.DEPT_HEAD]: 0,
  [ROLES.CHIEF]:     1,
});

/** Roles that must carry a deptId. */
export const DEPT_SCOPED_ROLES = new Set([ROLES.DEPT_HEAD]);

/** Which roles each role may assign to new users. */
export const ASSIGNABLE_BY = Object.freeze({
  [ROLES.CHIEF]:     [ROLES.DEPT_HEAD],
  [ROLES.DEPT_HEAD]: [],
});

export function canAssignRole(assignerRole, targetRole) {
  return (ASSIGNABLE_BY[assignerRole] || []).includes(targetRole);
}

export function isRoleAtLeast(myRole, targetRole) {
  return (ROLE_LEVEL[myRole] ?? -1) >= (ROLE_LEVEL[targetRole] ?? 0);
}