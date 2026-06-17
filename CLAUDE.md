# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install deps
npm run dev       # Vite dev server
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

There is no lint or test tooling configured in this repo (no ESLint/Prettier config, no test runner, no `lint`/`test` script in `package.json`). Don't assume `npm test` or `npm run lint` exist.

The app requires a Supabase project to run (see "Shared persistence" below). Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from the project's Settings → API page, plus `SUPABASE_SERVICE_ROLE_KEY` (only needed for the seed script, never bundled into the app). Without `.env.local`, the app still loads (login works) but shows "Supabase não configurado" after login instead of crashing — see `src/db/supabaseClient.js`'s `supabaseConfigured` guard.

Demo logins (seeded into `localStorage` on first run by `initDb()` in `src/auth/mockDb.js`):
| Username | Password | Role |
|---|---|---|
| chief | chief123 | CHIEF |
| math.head | math123 | DEPT_HEAD (MATH) |
| phys.head | phys123 | DEPT_HEAD (PHYS) |
| cs.head | cs123 | DEPT_HEAD (CS) |
| chem.head | chem123 | DEPT_HEAD (CHEM) |
| bio.head | bio123 | DEPT_HEAD (BIO) |

To reset the mock DB during manual testing, clear `localStorage` (or call `resetDb()` from `mockDb.js`) and reload.

## README.md is stale — don't trust its role/permission tables

`README.md` documents an aspirational 5-tier role system (`SYSTEM_ADMIN`, `DIRECTOR`, `DEPT_HEAD`, `DEPT_COORDINATOR`, `FACULTY`) with a `chiefId`/`admin` demo-account table. **The actual implemented system only has two roles**: `CHIEF` and `DEPT_HEAD` (see `src/auth/roles.js`, `src/auth/permissions.js`, `DEMO_CREDENTIALS` in `src/auth/mockDb.js`). The UI displays `CHIEF` with the Portuguese label "Diretor" (a recent rename, see git history), but the underlying role constant, permission keys, and code comments still say `CHIEF`/`CHIEF only` throughout. When working on roles/permissions, treat the `auth/*` source files as ground truth and ignore README sections that conflict with them. The rest of README.md (file structure, permission-checking patterns, auth flow, mock DB schema, production-migration checklist) is accurate and worth reading.

## Architecture

This is a single-page React 18 + Vite app with no router and no custom backend server — the client talks directly to a shared Supabase (Postgres) project for allocation data, and still uses a mocked local auth layer for login.

- **`src/main.jsx`** — mounts `App` from `classroom-allocation.jsx`.
- **`src/classroom-allocation.jsx`** (~1100 lines) — the entire app: constants (departments, days/hours, room-feature options), the auto-allocation algorithm (`autoAllocate`), and *every* UI component (`Dashboard`, `Grid`, `ListView`, `RoomCard`, `CourseCard`, all modals) defined inline in this one file. There is no component-per-file convention here — `src/components/` only holds the three components shared with the auth subsystem (`LoginPage`, `UserManagement`, `PermissionGate`).
- **`src/theme.jsx`** — `ThemeCtx` (light/dark token objects) and helpers `dtc`/`dbg` for department-tinted colors. Kept separate from the main file specifically to avoid circular imports.
- **`src/db/`** — Supabase data access layer (see "Shared persistence" below).
- **`src/auth/`** — self-contained mock auth/RBAC layer, still localStorage-only (not migrated to Supabase — see README.md for the detailed auth flow, mock DB schema, and the production-migration checklist marked with `// TODO (production):` comments throughout these files):
  - `roles.js` / `permissions.js` — role and permission constants + the `ROLE_PERMISSIONS` map.
  - `mockDb.js` — `localStorage`-backed "database" (`cas_db_users`, `cas_db_sessions` keys); every function here is meant to become an API call in production.
  - `utils.js` — password hashing/token generation (intentionally not production-grade crypto).
  - `AuthContext.jsx` — `AuthProvider`/`useAuth()`; exposes `currentUser`, `login`, `logout`, `can(perm)`, `canForDept(perm, deptId)`.

### Shared persistence (Supabase)

`courses` (incl. room assignment), `rooms` (incl. features/description), `deptStatuses`, and `notifications` live in a shared Supabase Postgres project, not localStorage — this is what lets a `DEPT_HEAD`'s allocation actually become visible to the `CHIEF` on a different machine, which plain client-side state can't do. Schema: `supabase/schema.sql` (run once in the Supabase SQL editor on a new project — also enables Realtime replication and permissive RLS policies, flagged `TODO (production)` for later tightening). Seed data: `scripts/seed-supabase.mjs` (one-off Node script, run manually once with the service-role key — reproduces the same deterministic placeholder *course* generator the app used to run client-side; no longer seeds rooms, since real room data is imported separately, see below).

`rooms.dept_id` is nullable: a room with `dept_id = null` is a **shared room** with no owning department (e.g. the real-world "Espaço Integrado" and the CCN2 blocks — see `scripts/import-real-rooms.mjs`). `gDept()` in `classroom-allocation.jsx` falls back to a `SHARED_ROOM_DEPT` display object for these so badge/color rendering doesn't need null-checks everywhere. Department heads never see shared rooms at all (`visRooms` for a `DEPT_HEAD` only includes `r.deptId===currentUser.deptId`); only the `CHIEF` sees and can allocate/edit them — this is intentional, not a bug, because these real rooms don't belong to any single department.

- **`src/db/supabaseClient.js`** — the shared client; exports `supabaseConfigured` (false when env vars are missing) so the rest of the app can fail gracefully instead of crashing at import time.
- **`src/db/allocations.js`** — one function per mutation (`allocateCourse`, `deallocateCourse`, `editCourse`, `saveRoomFeatures`, `applyAllocations`, `finishDept`, `setDeptStatus`, `markAllNotificationsRead`) plus `fetchAll()` for the initial load. Functions throw on `{error}`; call sites in `Dashboard` catch and `showToast`.
- **`src/db/useRealtimeSync.js`** — subscribes to Postgres realtime changes on all 4 tables and is the *only* path that updates local `rooms`/`courses`/`deptStatuses`/`notifications` state. Mutation functions in `allocations.js` deliberately don't update state themselves (no optimistic updates) — both the acting browser and any other open session learn about a change the same way, through this subscription. There's a small round-trip delay before your own action visibly lands; that's accepted for this scale rather than building optimistic-update reconciliation.

`Dashboard` fetches once on mount via `db.fetchAll()` into the same state shape the render tree (`Grid`, `ListView`, `RoomCard`, modals) already expected — so most of the rendering code didn't need to change, only where state originates and how writes happen.

### Role-based UI behavior

`CHIEF` (displayed as "Diretor") sees and can act across all departments, manages users, and can reopen/force-finish a department's allocation status. `DEPT_HEAD` (displayed as "Chefe de Departamento") is scoped to their own `deptId`, can be locked out of editing once their department status is `finished` or `force_finished`, and submits their work via "Marcar como Concluído" (triggers `handleFinish`, which flips `deptStatuses` and pushes a notification the CHIEF sees). The sidebar has a "Pendentes / Alocadas" tab toggle so either role can always check what's already been allocated and where, not just what's left.

### Localization

All user-facing strings (labels, buttons, toasts, day/department names) are hardcoded in Portuguese (pt-BR) directly in JSX — there is no i18n layer. Keep new UI text consistent with this (pt-BR), even though identifiers/comments in the auth subsystem are in English.

### Deployment

Two GitHub Actions workflows (`.github/workflows/deploy-dev.yml`, `deploy-main.yml`) build with Vite and publish to the `gh-pages` branch using `peaceiris/actions-gh-pages`, both with `keep_files: true` so they don't clobber each other:
- push to `main` → deployed to the GitHub Pages root (`VITE_BASE=/classroom-management/`)
- push to `dev` → deployed under `/dev/` (`VITE_BASE=/classroom-management/dev/`, `destination_dir: dev`)

`vite.config.js` reads `VITE_BASE` from the environment (set by these workflows) and falls back to `/classroom-management/` for local builds. Both workflows also inject `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from GitHub repo secrets at build time — `main` and `dev` currently point at the same single Supabase project/dataset (no separate dev/prod data), a known limitation of this prototype stage.
