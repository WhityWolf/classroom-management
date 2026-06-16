/**
 * auth/AuthContext.jsx
 * React context that exposes authentication state and actions to the whole tree.
 *
 * Usage:
 *   // Wrap your app root:
 *   <AuthProvider><App /></AuthProvider>
 *
 *   // Inside any component:
 *   const { currentUser, login, logout, can, canForDept } = useAuth();
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { initDb, loginUser, validateSession, revokeSession, getUserById } from './mockDb.js';
import { hasPermission } from './permissions.js';
import { DEPT_SCOPED_ROLES } from './roles.js';

// ── Storage key for the persisted session token ───────────────────────────────
//
// TODO (production): Do NOT store the token in localStorage in production.
// Use an httpOnly cookie set by the server. localStorage is vulnerable to XSS.
const SESSION_TOKEN_KEY = 'cas_session_token';

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Initialises the mock database, restores any persisted session on mount,
 * and provides auth state + actions to the subtree.
 */
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading,   setIsLoading]   = useState(true);  // true while session is being checked
  const [authError,   setAuthError]   = useState(null);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    initDb(); // no-op if already seeded

    const storedToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (storedToken) {
      const user = validateSession(storedToken);
      setCurrentUser(user);   // null if expired or invalid
    }
    setIsLoading(false);
  }, []);

  // ── login ───────────────────────────────────────────────────────────────────
  /**
   * Authenticate with username + password.
   * Returns `{ ok: true }` on success or `{ ok: false, message: string }` on failure.
   *
   * TODO (production): Call POST /api/auth/login; read token from the Set-Cookie
   * response header rather than storing it in JS.
   *
   * @param {string} username
   * @param {string} password
   * @returns {{ ok: boolean, message?: string }}
   */
  const login = useCallback((username, password) => {
    setAuthError(null);
    const result = loginUser(username, password);
    if (!result) {
      const msg = 'Usuário ou senha inválidos.';
      setAuthError(msg);
      return { ok: false, message: msg };
    }
    localStorage.setItem(SESSION_TOKEN_KEY, result.token);
    setCurrentUser(result.user);
    return { ok: true };
  }, []);

  // ── logout ──────────────────────────────────────────────────────────────────
  /**
   * Revoke the current session and clear local state.
   *
   * TODO (production): Call POST /api/auth/logout; clear the httpOnly cookie
   * server-side. Redirect to the login page.
   */
  const logout = useCallback(() => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (token) revokeSession(token);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    setCurrentUser(null);
    setAuthError(null);
  }, []);

  // ── refreshUser ─────────────────────────────────────────────────────────────
  /**
   * Re-fetch the current user from the database.
   * Call this after updating the current user's own profile.
   */
  const refreshUser = useCallback(() => {
    if (currentUser) {
      const fresh = getUserById(currentUser.id);
      setCurrentUser(fresh);
    }
  }, [currentUser]);

  // ── Permission helpers ──────────────────────────────────────────────────────

  /**
   * Returns true if the current user holds `perm`.
   * @param {string} perm – one of the PERMS constants
   * @returns {boolean}
   */
  const can = useCallback((perm) => {
    if (!currentUser) return false;
    return hasPermission(currentUser.role, perm);
  }, [currentUser]);

  /**
   * Returns true if the current user holds `perm` and is authorised to act
   * on `targetDeptId`.
   *
   * - Institution-wide roles (DIRECTOR, SYSTEM_ADMIN) can act on any dept.
   * - Dept-scoped roles can only act on their own department.
   *
   * @param {string} perm
   * @param {string} targetDeptId
   * @returns {boolean}
   */
  const canForDept = useCallback((perm, targetDeptId) => {
    if (!currentUser) return false;
    if (!hasPermission(currentUser.role, perm)) return false;
    if (!DEPT_SCOPED_ROLES.has(currentUser.role)) return true; // institution-wide
    return currentUser.deptId === targetDeptId;
  }, [currentUser]);

  // ── Context value ───────────────────────────────────────────────────────────

  const value = {
    currentUser,   // null | sanitized user object
    isLoading,     // true while initial session check is in progress
    authError,     // last login error message, or null
    login,
    logout,
    refreshUser,
    can,
    canForDept,
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