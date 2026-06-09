# Classroom Allocation System — Architecture Guide

## Overview

This is a React SPA prototype with a complete auth/RBAC foundation ready
for production migration. Every layer that would call a real backend is
clearly marked with `// TODO (production):` comments.

---

## Quick Start

```bash
npm create vite@latest cas -- --template react
cd cas
# Copy all files from this directory into src/
npm install
npm run dev
```

Login with any demo credential from the login screen.

---

## File Structure

```
src/
├── classroom-allocation.jsx   Entry point, root providers, full UI
├── theme.jsx                  Theme tokens (light/dark) + ThemeCtx
│
├── auth/
│   ├── roles.js               Role constants, hierarchy, assignment rules
│   ├── permissions.js         Permission constants + role→permission map
│   ├── utils.js               Password hashing, token generation, ID gen
│   ├── mockDb.js              localStorage mock DB + session management
│   └── AuthContext.jsx        React context, AuthProvider, useAuth hook
│
└── components/
    ├── LoginPage.jsx          Login form with demo credential table
    ├── UserManagement.jsx     Admin panel: list, create, edit, deactivate
    └── PermissionGate.jsx     Declarative permission-gated wrapper
```

---

## Role Hierarchy

```
SYSTEM_ADMIN (level 4)
  Full platform access. Only role that can create/edit/delete all users
  and assign any role. Intended for technical administrators, not
  academic staff.

DIRECTOR (level 3)
  Institutional director. Full read/write access to every department's
  courses and rooms. Cannot manage user accounts (that belongs to
  SYSTEM_ADMIN). Can view the user list.

DEPT_HEAD (level 2)
  Department head (e.g. "Chief of the Department of Mathematics").
  Full control over their own department: courses, rooms, allocations.
  Read-only view of other departments. Can create DEPT_COORDINATOR and
  FACULTY accounts within their own department.

DEPT_COORDINATOR (level 1)
  Allocation coordinator for a specific department. Can manage room
  allocations (assign, deallocate, merge) for their own department.
  Can view all rooms across departments to find vacant slots.
  Cannot modify courses themselves.

FACULTY (level 0)
  Read-only. Can view their own department's courses and room schedule.
  Cannot make any changes.
```

### Department scoping

Roles at levels 0–2 are **dept-scoped**: they must be associated with a
`deptId` and their actions are restricted to that department.

Roles at levels 3–4 are **institution-wide**: `deptId` is null and they
can act across all departments. In the UI, they get a department selector
dropdown instead of a fixed department label.

---

## Permission System

Permissions live in `auth/permissions.js`. The full list is in the `PERMS`
object. Key permission groups:

| Group       | Key permissions                                           |
|-------------|-----------------------------------------------------------|
| Courses     | VIEW_*, CREATE_COURSE, EDIT_*, DELETE_*                   |
| Rooms       | VIEW_*, EDIT_*, EDIT_ROOM_DESCRIPTION                     |
| Allocations | ALLOCATE_OWN_DEPT, ALLOCATE_ALL_DEPTS, MERGE_GROUPS       |
| Users       | VIEW_USERS, CREATE_*, EDIT_*, DEACTIVATE_USER, ASSIGN_ROLES |
| Reports     | VIEW_OWN_DEPT_REPORTS, VIEW_ALL_REPORTS                   |

### Checking permissions in components

```jsx
// Option 1 — hook
const { can, canForDept } = useAuth();
if (can(PERMS.ALLOCATE_OWN_DEPT)) { /* ... */ }
if (canForDept(PERMS.ALLOCATE_OWN_DEPT, 'MATH')) { /* ... */ }

// Option 2 — declarative wrapper (renders nothing if denied)
<PermissionGate perm={PERMS.EDIT_ROOM_DESCRIPTION}>
  <EditDescButton />
</PermissionGate>

// Option 3 — with fallback
<PermissionGate perm={PERMS.EDIT_ALL_COURSES} fallback={<ReadOnlyView />}>
  <EditableView />
</PermissionGate>

// Option 4 — dept-scoped
<PermissionGate perm={PERMS.ALLOCATE_OWN_DEPT} deptId="MATH">
  <AllocateButton />
</PermissionGate>
```

---

## Auth Flow

```
App mount
  │
  ├─ initDb()             Seed localStorage if empty (first run)
  │
  ├─ Read SESSION_TOKEN   from localStorage
  │     │
  │     ├─ Token present → validateSession(token)
  │     │       │
  │     │       ├─ Valid, not expired → setCurrentUser(user) → Dashboard
  │     │       └─ Invalid / expired  → setCurrentUser(null) → LoginPage
  │     │
  │     └─ No token → setCurrentUser(null) → LoginPage
  │
LoginPage → login(username, password)
  │
  ├─ loginUser() in mockDb.js
  │     ├─ Looks up user by username
  │     ├─ Verifies password hash
  │     ├─ Creates session record
  │     └─ Returns { user, token }
  │
  ├─ Store token in localStorage  ← TODO: httpOnly cookie in production
  ├─ setCurrentUser(user)
  └─ AppRouter renders Dashboard
```

---

## Mock Database

`auth/mockDb.js` uses `localStorage` as a stand-in for a real database.

| localStorage key   | Content                      |
|--------------------|------------------------------|
| `cas_db_users`     | JSON array of user objects   |
| `cas_db_sessions`  | JSON array of session objects |

### User object schema

```js
{
  id:           "usr_seed_0001",   // unique identifier
  username:     "math.head",       // login handle, lowercase
  name:         "Prof. Eleanor Chen",
  email:        "math.head@westmore.edu",
  role:         "DEPT_HEAD",       // one of ROLES constants
  deptId:       "MATH",            // null for DIRECTOR / SYSTEM_ADMIN
  passwordHash: "ph_...",          // hashed; never plain-text
  isActive:     true,
  createdAt:    "2025-01-01T00:00:00.000Z",
  createdBy:    "usr_seed_0001",   // null for seed data
  lastLogin:    "2025-09-01T09:00:00.000Z",
}
```

### Session object schema

```js
{
  token:     "tok_a3f...",          // random 48-hex-char string
  userId:    "usr_seed_0003",
  createdAt: "2025-09-01T09:00:00.000Z",
  expiresAt: "2025-09-01T17:00:00.000Z",  // createdAt + 8h
}
```

---

## Demo Accounts

| Username      | Password     | Role              | Dept |
|---------------|--------------|-------------------|------|
| admin         | admin123     | System Admin      | —    |
| director      | director123  | Director          | —    |
| math.head     | math123      | Dept Head         | MATH |
| phys.head     | phys123      | Dept Head         | PHYS |
| cs.head       | cs123        | Dept Head         | CS   |
| chem.head     | chem123      | Dept Head         | CHEM |
| math.coord    | coord123     | Dept Coordinator  | MATH |
| math.viewer   | viewer123    | Faculty           | MATH |

---

## Production Migration Checklist

Every placeholder is marked `// TODO (production):` in the source. Here
is the full list:

### Authentication
- [ ] Replace `hashPassword` / `verifyPassword` with `bcryptjs` (cost ≥ 12)
- [ ] Replace `generateToken` with signed JWTs (RS256 recommended)
- [ ] Move token storage from `localStorage` to `httpOnly Secure SameSite=Strict` cookies
- [ ] Add rate-limiting and account lockout after N failed login attempts
- [ ] Implement refresh token rotation
- [ ] Add MFA (TOTP) support for DIRECTOR and SYSTEM_ADMIN roles

### Session management
- [ ] Move session records from localStorage to a server-side store (Redis)
- [ ] Use JWT `exp` claim for expiry instead of a DB record
- [ ] Implement sliding session expiry on activity

### Database
- [ ] Replace every `localStorage.getItem / setItem` in `mockDb.js` with
      `fetch()` calls to your REST API or an ORM (Prisma / Drizzle)
- [ ] Add database indexes on `users.username` and `users.email`
- [ ] Implement proper soft-delete with audit log table
- [ ] Add row-level security so dept-scoped queries are enforced at DB level

### API
- [ ] Each `mockDb.js` function has its corresponding endpoint in a comment
      (`// TODO: POST /api/users` etc.) — implement those endpoints
- [ ] Add input validation middleware (Zod / Yup) on every endpoint
- [ ] Add CSRF protection on mutating endpoints
- [ ] Enforce permissions server-side — never trust client-side checks alone

### Roles / Permissions
- [ ] The `ROLE_PERMISSIONS` map in `permissions.js` maps 1:1 to a
      `role_permissions` join table — migrate it there
- [ ] Add permission caching layer (Redis) for high-traffic deployments
- [ ] Consider per-resource ABAC (attribute-based) for fine-grained sharing

### Infrastructure
- [ ] Add audit logging for all auth events (login, logout, permission denied)
- [ ] Set up monitoring / alerting on failed login spikes
- [ ] Rotate `PEPPER` in `utils.js` via a secret manager (AWS Secrets Manager,
      HashiCorp Vault) and re-hash passwords on next login

---

## Adding a New Role

1. Add the constant to `ROLES` in `auth/roles.js`
2. Add the label to `ROLE_LABELS`
3. Set the numeric level in `ROLE_LEVEL`
4. Decide if it's dept-scoped — if so, add it to `DEPT_SCOPED_ROLES`
5. Update `ASSIGNABLE_BY` to control who can grant this role
6. Define its permission set in `ROLE_PERMISSIONS` in `auth/permissions.js`
7. Add a seed user (optional) in `DEMO_CREDENTIALS` in `auth/mockDb.js`
8. Add a colour variant to `RoleBadge` in `components/UserManagement.jsx`

## Adding a New Permission

1. Add the constant to `PERMS` in `auth/permissions.js`
2. Add it to the appropriate role arrays in `ROLE_PERMISSIONS`
3. Use `can(PERMS.YOUR_NEW_PERM)` or `<PermissionGate perm={...}>` in UI
4. Enforce it server-side in the corresponding API handler
