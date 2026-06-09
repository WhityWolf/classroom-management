/**
 * auth/roles.js
 * Role definitions, hierarchy, and assignment rules for the CAS.
 *
 * Hierarchy (descending authority):
 *   SYSTEM_ADMIN > DIRECTOR > DEPT_HEAD > DEPT_COORDINATOR > FACULTY
 */

export const ROLES = Object.freeze({
  SYSTEM_ADMIN:     'SYSTEM_ADMIN',     // Full platform control + user management
  DIRECTOR:         'DIRECTOR',         // Institutional director – all depts, no user mgmt
  DEPT_HEAD:        'DEPT_HEAD',        // Department head – full own dept, read-only others
  DEPT_COORDINATOR: 'DEPT_COORDINATOR', // Allocation coordinator – own-dept allocations only
  FACULTY:          'FACULTY',          // Faculty member – read-only
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.SYSTEM_ADMIN]:     'System Administrator',
  [ROLES.DIRECTOR]:         'Institutional Director',
  [ROLES.DEPT_HEAD]:        'Department Head',
  [ROLES.DEPT_COORDINATOR]: 'Department Coordinator',
  [ROLES.FACULTY]:          'Faculty Member',
});

/**
 * Numeric level for hierarchy comparisons.
 * Higher value = more authority. Never rely on specific numbers — compare relatively.
 */
export const ROLE_LEVEL = Object.freeze({
  [ROLES.FACULTY]:          0,
  [ROLES.DEPT_COORDINATOR]: 1,
  [ROLES.DEPT_HEAD]:        2,
  [ROLES.DIRECTOR]:         3,
  [ROLES.SYSTEM_ADMIN]:     4,
});

/**
 * Roles that must be associated with a specific department.
 * Institution-wide roles (DIRECTOR, SYSTEM_ADMIN) have deptId = null.
 */
export const DEPT_SCOPED_ROLES = new Set([
  ROLES.DEPT_HEAD,
  ROLES.DEPT_COORDINATOR,
  ROLES.FACULTY,
]);

/**
 * Which roles each role level is permitted to assign.
 * Principle: you can only grant roles strictly below your own level.
 */
export const ASSIGNABLE_BY = Object.freeze({
  [ROLES.SYSTEM_ADMIN]:     [ROLES.DIRECTOR, ROLES.DEPT_HEAD, ROLES.DEPT_COORDINATOR, ROLES.FACULTY],
  [ROLES.DIRECTOR]:         [ROLES.DEPT_HEAD, ROLES.DEPT_COORDINATOR, ROLES.FACULTY],
  [ROLES.DEPT_HEAD]:        [ROLES.DEPT_COORDINATOR, ROLES.FACULTY],
  [ROLES.DEPT_COORDINATOR]: [],
  [ROLES.FACULTY]:          [],
});

/**
 * Returns true if `assignerRole` is allowed to assign `targetRole` to a new user.
 * @param {string} assignerRole
 * @param {string} targetRole
 * @returns {boolean}
 */
export function canAssignRole(assignerRole, targetRole) {
  return (ASSIGNABLE_BY[assignerRole] || []).includes(targetRole);
}

/**
 * Returns true if `myRole` has equal or higher authority than `targetRole`.
 * @param {string} myRole
 * @param {string} targetRole
 * @returns {boolean}
 */
export function isRoleAtLeast(myRole, targetRole) {
  return (ROLE_LEVEL[myRole] ?? -1) >= (ROLE_LEVEL[targetRole] ?? 0);
}
