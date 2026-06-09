/**
 * auth/utils.js
 * Low-level auth utilities: password hashing, token generation, ID generation.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠  SECURITY NOTICE                                                    ║
 * ║  Every function below is marked with a production TODO.                ║
 * ║  This file is intentionally a prototype — nothing here is              ║
 * ║  cryptographically suitable for a live deployment.                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

// ── Password ──────────────────────────────────────────────────────────────────

/**
 * A fixed pepper value.
 * TODO (production): move to an environment variable, rotate periodically.
 */
const PEPPER = 'cas-westmore-static-2025';

/**
 * Deterministic prototype hash. Produces the same output for the same input.
 *
 * TODO (production): Replace with
 *   const hash = await bcrypt.hash(password, 12);
 * using the `bcryptjs` or `argon2` package.
 *
 * @param {string} password
 * @returns {string}
 */
export function hashPassword(password) {
  const input = password + PEPPER;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
    h |= 0;
  }
  // Prefix 'ph_' so we can detect un-hashed values in tests
  return 'ph_' + Math.abs(h).toString(36) + '_' + btoa(input.slice(0, 6)).replace(/[=+/]/g, '');
}

/**
 * Verify a plain-text password against a stored hash.
 *
 * TODO (production): Replace with
 *   return await bcrypt.compare(password, storedHash);
 *
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
export function verifyPassword(password, storedHash) {
  return hashPassword(password) === storedHash;
}

// ── Session tokens ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random session token.
 *
 * TODO (production): Replace with a signed JWT:
 *   jwt.sign({ sub: userId, role, deptId, iat }, privateKey, { algorithm:'RS256', expiresIn:'8h' })
 * Store only in an httpOnly, Secure, SameSite=Strict cookie — never localStorage.
 *
 * @returns {string}
 */
export function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'tok_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── ID generation ─────────────────────────────────────────────────────────────

let _seq = Date.now();

/**
 * Generate a unique entity ID.
 *
 * TODO (production): Use `crypto.randomUUID()`, a CUID library, or let the
 * database (PostgreSQL SERIAL / UUID column) handle this.
 *
 * @param {string} prefix  e.g. 'usr', 'sess'
 * @returns {string}
 */
export function generateId(prefix = 'usr') {
  return `${prefix}_${(++_seq).toString(36)}`;
}

// ── Session lifetime ──────────────────────────────────────────────────────────

/** Default session TTL: 8 hours. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Returns true if the session object's `expiresAt` timestamp has passed.
 * @param {{ expiresAt: string }} session
 * @returns {boolean}
 */
export function isSessionExpired(session) {
  return Date.now() > new Date(session.expiresAt).getTime();
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
