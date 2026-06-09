/**
 * auth/mockDb.js
 * In-memory prototype database backed by localStorage.
 *
 * Every public function is annotated with the real API endpoint it maps to,
 * making the migration to a proper backend a straight substitution.
 *
 * TODO (production): Replace the localStorage calls in each function with
 * fetch() calls to your REST/GraphQL API or an ORM query (Prisma, Drizzle…).
 */

import { hashPassword, verifyPassword, generateToken, generateId,
         SESSION_TTL_MS, isSessionExpired } from './utils.js';
import { ROLES } from './roles.js';

// ── Storage keys ──────────────────────────────────────────────────────────────

export const DB_KEYS = Object.freeze({
  USERS:    'cas_db_users',
  SESSIONS: 'cas_db_sessions',
});

// ── Seed users ────────────────────────────────────────────────────────────────
//
// These are the demo accounts pre-loaded on first run.
// Passwords are stored in plain text here only so the login page can display
// them as demo credentials. They are hashed before being written to storage.

export const DEMO_CREDENTIALS = Object.freeze([
  { username: 'admin',       password: 'admin123',    role: ROLES.SYSTEM_ADMIN,     deptId: null,   name: 'System Administrator'   },
  { username: 'director',    password: 'director123', role: ROLES.DIRECTOR,         deptId: null,   name: 'Dr. Richard Ashford'    },
  { username: 'math.head',   password: 'math123',     role: ROLES.DEPT_HEAD,        deptId: 'MATH', name: 'Prof. Eleanor Chen'     },
  { username: 'phys.head',   password: 'phys123',     role: ROLES.DEPT_HEAD,        deptId: 'PHYS', name: 'Prof. Marcus Webb'      },
  { username: 'cs.head',     password: 'cs123',       role: ROLES.DEPT_HEAD,        deptId: 'CS',   name: 'Prof. Aisha Rahman'     },
  { username: 'chem.head',   password: 'chem123',     role: ROLES.DEPT_HEAD,        deptId: 'CHEM', name: 'Prof. David Santos'     },
  { username: 'math.coord',  password: 'coord123',    role: ROLES.DEPT_COORDINATOR, deptId: 'MATH', name: 'Ms. Patricia Osei'      },
  { username: 'math.viewer', password: 'viewer123',   role: ROLES.FACULTY,          deptId: 'MATH', name: 'Dr. James Kowalski'     },
]);

// ── Private helpers ───────────────────────────────────────────────────────────

function readUsers()      { return JSON.parse(localStorage.getItem(DB_KEYS.USERS)    || '[]'); }
function readSessions()   { return JSON.parse(localStorage.getItem(DB_KEYS.SESSIONS) || '[]'); }
function writeUsers(u)    { localStorage.setItem(DB_KEYS.USERS,    JSON.stringify(u)); }
function writeSessions(s) { localStorage.setItem(DB_KEYS.SESSIONS, JSON.stringify(s)); }

/** Strip the passwordHash from a user object before returning it to callers. */
function sanitize({ passwordHash: _, ...user }) { return user; }

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Seed localStorage with demo data on first run.
 * Safe to call multiple times — only runs when the users key is absent.
 *
 * TODO (production): Replace with a database migration + seed script.
 */
export function initDb() {
  if (!localStorage.getItem(DB_KEYS.USERS)) {
    const now = new Date().toISOString();
    const users = DEMO_CREDENTIALS.map((u, i) => ({
      id:           `usr_seed_${String(i + 1).padStart(4, '0')}`,
      username:     u.username,
      name:         u.name,
      email:        `${u.username.replace('.', '_')}@westmore.edu`,
      role:         u.role,
      deptId:       u.deptId,
      passwordHash: hashPassword(u.password),
      isActive:     true,
      createdAt:    now,
      createdBy:    null,   // seed data has no creator
      lastLogin:    null,
    }));
    writeUsers(users);
  }
  if (!localStorage.getItem(DB_KEYS.SESSIONS)) {
    writeSessions([]);
  }
}

/**
 * Wipe the database and re-seed. Useful for development / testing.
 */
export function resetDb() {
  localStorage.removeItem(DB_KEYS.USERS);
  localStorage.removeItem(DB_KEYS.SESSIONS);
  initDb();
}

// ── User queries ──────────────────────────────────────────────────────────────

/** GET /api/users */
export function getUsers() {
  return readUsers().map(sanitize);
}

/** GET /api/users/:id */
export function getUserById(id) {
  const u = readUsers().find(u => u.id === id);
  return u ? sanitize(u) : null;
}

/** GET /api/users?username=:username */
export function getUserByUsername(username) {
  const u = readUsers().find(u => u.username === username.toLowerCase().trim());
  return u ? sanitize(u) : null;
}

// ── User mutations ────────────────────────────────────────────────────────────

/**
 * POST /api/users
 * @param {{ username, name, email, role, deptId, password }} data
 * @param {string} createdById
 * @returns {object} sanitized user
 * @throws if username or email already exists
 */
export function createUser(data, createdById) {
  const users = readUsers();
  const uname = data.username.toLowerCase().trim();
  const email = data.email.toLowerCase().trim();

  if (users.some(u => u.username === uname))
    throw new Error(`Username "${uname}" is already taken.`);
  if (users.some(u => u.email === email))
    throw new Error(`Email "${email}" is already registered.`);
  if (!data.password || data.password.length < 6)
    throw new Error('Password must be at least 6 characters.');

  const user = {
    id:           generateId('usr'),
    username:     uname,
    name:         data.name.trim(),
    email,
    role:         data.role,
    deptId:       data.deptId || null,
    passwordHash: hashPassword(data.password),
    isActive:     true,
    createdAt:    new Date().toISOString(),
    createdBy:    createdById,
    lastLogin:    null,
  };

  writeUsers([...users, user]);
  return sanitize(user);
}

/**
 * PATCH /api/users/:id
 * Accepts a partial update; handles password re-hashing automatically.
 * @param {string} id
 * @param {Partial<{name,email,role,deptId,password,isActive}>} updates
 * @returns {object} updated sanitized user
 */
export function updateUser(id, updates) {
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === id);
  if (idx < 0) throw new Error('User not found.');

  const patch = { ...updates };

  if (patch.password !== undefined) {
    if (patch.password && patch.password.length < 6)
      throw new Error('Password must be at least 6 characters.');
    patch.passwordHash = patch.password ? hashPassword(patch.password) : users[idx].passwordHash;
    delete patch.password;
  }
  if (patch.username) patch.username = patch.username.toLowerCase().trim();
  if (patch.email)    patch.email    = patch.email.toLowerCase().trim();

  users[idx] = { ...users[idx], ...patch, updatedAt: new Date().toISOString() };
  writeUsers(users);
  return sanitize(users[idx]);
}

/**
 * DELETE /api/users/:id  (soft-delete — sets isActive: false)
 * Hard deletion is intentionally not exposed; deactivation preserves audit trails.
 * @param {string} id
 */
export function deactivateUser(id) {
  updateUser(id, { isActive: false });
  // Also revoke all their sessions
  writeSessions(readSessions().filter(s => s.userId !== id));
}

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Validates credentials and returns a session token + sanitized user, or null.
 *
 * TODO (production):
 *   1. Use async bcrypt.compare for password verification.
 *   2. Issue a signed JWT instead of a random token.
 *   3. Set the token in an httpOnly Secure SameSite=Strict cookie — never expose
 *      it to JavaScript in production.
 *   4. Apply rate-limiting / account lockout after N failed attempts.
 *
 * @param {string} username
 * @param {string} password
 * @returns {{ user: object, token: string } | null}
 */
export function loginUser(username, password) {
  // Fetch raw user (with passwordHash) directly — do NOT use sanitize() here
  const raw = readUsers().find(u => u.username === username.toLowerCase().trim());
  if (!raw || !raw.isActive) return null;
  if (!verifyPassword(password, raw.passwordHash)) return null;

  const token   = generateToken();
  const session = {
    token,
    userId:    raw.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };

  // One active session per user (replace any existing)
  writeSessions([...readSessions().filter(s => s.userId !== raw.id), session]);

  // Update lastLogin timestamp
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === raw.id);
  if (idx >= 0) { users[idx].lastLogin = new Date().toISOString(); writeUsers(users); }

  return { user: sanitize(raw), token };
}

/**
 * GET /api/auth/me  (or JWT verification middleware)
 * Validates a token and returns the associated user, or null if invalid/expired.
 *
 * TODO (production): Verify JWT signature + expiry claim; no database lookup
 * needed if claims are embedded in the token (self-contained JWT).
 *
 * @param {string|null} token
 * @returns {object|null} sanitized user
 */
export function validateSession(token) {
  if (!token) return null;
  const session = readSessions().find(s => s.token === token);
  if (!session) return null;
  if (isSessionExpired(session)) {
    revokeSession(token);
    return null;
  }
  return getUserById(session.userId);
}

/**
 * POST /api/auth/logout
 * Removes the session so the token is immediately invalidated.
 *
 * TODO (production): With JWTs, maintain a server-side blocklist for revoked
 * tokens (Redis TTL keyed by jti claim) until they naturally expire.
 *
 * @param {string} token
 */
export function revokeSession(token) {
  writeSessions(readSessions().filter(s => s.token !== token));
}
