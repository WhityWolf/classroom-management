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
 *   // Dept-scoped check:
 *   <PermissionGate perm={PERMS.ALLOCATE_OWN_DEPT} deptId="MATH">
 *     <AllocateButton />
 *   </PermissionGate>
 */

import { useAuth } from '../auth/AuthContext.jsx';

/**
 * @param {object}        props
 * @param {string}        props.perm      – one of the PERMS constants (required)
 * @param {string}        [props.deptId]  – if provided, also checks dept scope
 * @param {React.ReactNode} [props.fallback] – rendered when permission is absent
 * @param {React.ReactNode} props.children
 */
export default function PermissionGate({ perm, deptId, fallback = null, children }) {
  const { can, canForDept } = useAuth();

  const allowed = deptId !== undefined
    ? canForDept(perm, deptId)
    : can(perm);

  return allowed ? children : fallback;
}
