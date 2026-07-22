/**
 * auth/AuthContext.jsx
 * React context that exposes authentication state and actions to the whole tree.
 *
 * Usage:
 *   // Wrap your app root:
 *   <AuthProvider><App /></AuthProvider>
 *
 *   // Inside any component:
 *   const { currentUser, login, logout, can, canForRole } = useAuth();
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loginUser, validateSession, revokeSession, getUserById } from '../db/authApi.js';
import { fetchRoleById } from '../db/management.js';
import { hasPermission } from './permissions.js';
import { isInstitutionalRole } from './roles.js';
import { SESSION_TOKEN_KEY } from '../db/sessionToken.js';

// ── Storage key for the persisted session token ───────────────────────────────
//
// Server-validated now (validateSession hits Postgres via RPC instead of a
// localStorage array), but still stored client-side in localStorage rather
// than an httpOnly cookie — there's no custom backend server to set one.
// Revisit this once the system moves behind a real server (see CLAUDE.md's
// "Deployment target"). The key itself lives in db/sessionToken.js — the db
// layer reads it directly from every mutating RPC call, so both places share
// one definition instead of two copies that could drift.

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

// `currentUser.role` is the full role row (id, subUnitId, name, permissions,
// isSystem), not just an id — `can`/`canForRole` read permissions off it.
async function withRole(user) {
  if (!user) return null;
  const role = await fetchRoleById(user.roleId);
  return { ...user, role };
}

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Restores any persisted session on mount, and provides auth state +
 * actions to the subtree.
 */
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading,   setIsLoading]   = useState(true);  // true while session is being checked
  const [authError,   setAuthError]   = useState(null);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const storedToken = localStorage.getItem(SESSION_TOKEN_KEY);
      if (storedToken) {
        try {
          const user = await validateSession(storedToken);
          setCurrentUser(await withRole(user));
          if (!user) localStorage.removeItem(SESSION_TOKEN_KEY);
        } catch {
          setCurrentUser(null);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  // ── login ───────────────────────────────────────────────────────────────────
  /**
   * Authenticate with username + password.
   * Returns `{ ok: true }` on success or `{ ok: false, message: string }` on failure.
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  const login = useCallback(async (username, password) => {
    setAuthError(null);
    try {
      const result = await loginUser(username, password);
      if (!result) {
        const msg = 'Usuário ou senha inválidos.';
        setAuthError(msg);
        return { ok: false, message: msg };
      }
      localStorage.setItem(SESSION_TOKEN_KEY, result.token);
      setCurrentUser(await withRole(result.user));
      return { ok: true };
    } catch (e) {
      const msg = e.message || 'Falha ao entrar.';
      setAuthError(msg);
      return { ok: false, message: msg };
    }
  }, []);

  // ── logout ──────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    setCurrentUser(null);
    setAuthError(null);
    if (token) revokeSession(token).catch(() => {}); // best-effort, user is logged out client-side regardless
  }, []);

  // ── refreshUser ─────────────────────────────────────────────────────────────
  /**
   * Re-fetch the current user from the database.
   * Call this after updating the current user's own profile.
   */
  const refreshUser = useCallback(async () => {
    if (!currentUser) return;
    const fresh = await getUserById(currentUser.id);
    setCurrentUser(await withRole(fresh));
  }, [currentUser]);

  // ── Permission helpers ──────────────────────────────────────────────────────

  /**
   * Returns true if the current user's role holds `perm`.
   * @param {string} perm – one of the PERMS constants
   * @returns {boolean}
   */
  const can = useCallback((perm) => {
    if (!currentUser) return false;
    return hasPermission(currentUser.role, perm);
  }, [currentUser]);

  /**
   * Returns true if the current user holds `perm` and is authorised to act
   * on `targetRoleId` (a coordination/role, not a whole sub-unit).
   *
   * - Institutional roles (e.g. Diretor, Secretário do Diretor) can act on
   *   any role/coordination.
   * - Coordination-scoped roles can only act on their own role.
   *
   * @param {string} perm
   * @param {string} targetRoleId
   * @returns {boolean}
   */
  const canForRole = useCallback((perm, targetRoleId) => {
    if (!currentUser) return false;
    if (!hasPermission(currentUser.role, perm)) return false;
    if (isInstitutionalRole(currentUser.role)) return true;
    return currentUser.roleId === targetRoleId;
  }, [currentUser]);

  // ── Context value ───────────────────────────────────────────────────────────

  const value = {
    currentUser,   // null | sanitized user object, with `.role` (full row) attached
    isLoading,     // true while initial session check is in progress
    authError,     // last login error message, or null
    login,
    logout,
    refreshUser,
    can,
    canForRole,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Access auth state and actions from any component inside AuthProvider.
 * Throws if called outside the provider tree.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
