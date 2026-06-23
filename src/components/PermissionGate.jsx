/**
 * components/PermissionGate.jsx
 * Renders children only when the current user holds the required permission.
 *
 * Usage:
 *   // Render nothing when permission is absent:
 *   <PermissionGate perm={PERMS.ALLOCATE_OWN_DEPT}>
 *     <AllocateButton />
 *   </PermissionGate>
 *
 *   // Render a fallback instead:
 *   <PermissionGate perm={PERMS.EDIT_ALL_COURSES} fallback={<ReadOnlyBadge />}>
 *     <EditButton />
 *   </PermissionGate>
 *
 *   // Role/coordination-scoped check:
 *   <PermissionGate perm={PERMS.ALLOCATE_OWN_ROOMS} roleId="MATH_GRAD_COORD">
 *     <AllocateButton />
 *   </PermissionGate>
 */

import { useAuth } from '../auth/AuthContext.jsx';

/**
 * @param {object}        props
 * @param {string}        props.perm      – one of the PERMS constants (required)
 * @param {string}        [props.roleId]  – if provided, also checks role/coordination scope
 * @param {React.ReactNode} [props.fallback] – rendered when permission is absent
 * @param {React.ReactNode} props.children
 */
export default function PermissionGate({ perm, roleId, fallback = null, children }) {
  const { can, canForRole } = useAuth();

  const allowed = roleId !== undefined
    ? canForRole(perm, roleId)
    : can(perm);

  return allowed ? children : fallback;
}
