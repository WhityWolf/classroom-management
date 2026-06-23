/**
 * auth/roles.js — helpers over `role` rows loaded dynamically from the
 * `roles` table (src/db/management.js), not a fixed two-value enum anymore.
 */

/**
 * A role is institutional when it isn't scoped to one sub-unit — it can act
 * across all sub-units/coordinations (subject to its own `permissions`).
 * Generalizes the old fixed CHIEF role to "however many institutional roles
 * the director creates" (e.g. Diretor, Secretário do Diretor).
 * @param {{subUnitId?: string|null}|null} role
 */
export const isInstitutionalRole = (role) => !!role && role.subUnitId == null;
