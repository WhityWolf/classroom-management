/**
 * auth/roles.js — Hierarquia de dois níveis de funções.
 */

export const ROLES = Object.freeze({
  CHIEF:     'CHIEF',
  DEPT_HEAD: 'DEPT_HEAD',
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.CHIEF]:     'Diretor (Administrador)',
  [ROLES.DEPT_HEAD]: 'Chefe de Departamento',
});

export const ROLE_LEVEL = Object.freeze({
  [ROLES.DEPT_HEAD]: 0,
  [ROLES.CHIEF]:     1,
});

export const DEPT_SCOPED_ROLES = new Set([ROLES.DEPT_HEAD]);

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