-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- for a freshly created project, before running scripts/seed-supabase.mjs.

create table rooms (
  id          text primary key,
  dept_id     text,  -- null = shared room with no owning department (only the CHIEF allocates/edits it)
  label       text not null,
  cap         integer not null,
  type        text not null,
  features    text[] not null default '{}',
  building    text not null,
  floor       integer not null,
  description text not null default ''
);

create table courses (
  id      text primary key,
  code    text not null,
  name    text not null,
  -- Nullable on purpose: an ODS import with the "Turma" column left blank
  -- (see parseFlatCourseRows in classroom-allocation.jsx) has no real turma
  -- number to store. `sec IS NULL` is itself the "not informed" signal — the
  -- UI shows a "Turma N" badge only when `sec` is set. Manual creation via
  -- CourseEditModal always provides a real sec (the form requires one).
  sec     integer,
  dept_id text not null,
  teacher text not null default '',
  -- A course can meet on different days at different times (real SIGAA
  -- imports have ~5% of turmas like this, e.g. Monday one time block,
  -- Friday another) — one row per meeting block:
  -- [{"days":["Terça","Quinta"],"sh":8,"eh":10}, {"days":["Sexta"],"sh":14,"eh":16}]
  blocks  jsonb not null default '[]',
  enroll  integer not null,
  -- A disciplina pode estar em salas diferentes em dias diferentes (ex.:
  -- Segunda na Sala A, Quarta na Sala B) — não dá pra modelar isso com uma
  -- FK de sala única. room_by_day mapeia cada dia (string igual aos valores
  -- em blocks[].days, ex. "Segunda") para o id da sala alocada nesse dia;
  -- um dia ausente do mapa = ainda não alocado. Sem FK de banco pra cada
  -- valor (jsonb não suporta isso nativamente) — aceitável para o estágio
  -- de protótipo, como as outras FKs "soft" já documentadas neste arquivo.
  room_by_day jsonb not null default '{}'
);
create index courses_dept_idx on courses(dept_id);

create table dept_statuses (
  dept_id text primary key,
  status  text not null default 'active'  -- 'active' | 'finished' | 'force_finished'
);

create table notifications (
  id         bigint generated always as identity primary key,
  dept_id    text not null,
  dept_name  text not null,
  type       text not null,
  user_name  text not null,
  created_at timestamptz not null default now(),
  read       boolean not null default false
);

-- Catalog of selectable room resources (e.g. "Projetor"). Flat, no
-- categories — the CHIEF grows this list ad hoc as real needs come up
-- (see RoomFeaturesModal in classroom-allocation.jsx). Deleting an entry
-- here doesn't retroactively scrub it from rooms.features, it just stops
-- offering it for new selections.
create table room_features (
  name text primary key
);

alter table rooms enable row level security;
alter table courses enable row level security;
alter table dept_statuses enable row level security;
alter table notifications enable row level security;
alter table room_features enable row level security;

-- TODO (production): replace these permissive policies with rules scoped to
-- the authenticated user's role/dept once real Supabase Auth is wired up to
-- the role model in src/auth/*. For now, anon key has full read/write access,
-- matching this prototype's current "no real auth enforcement" stage.
create policy "anon full access" on rooms for all using (true) with check (true);
create policy "anon full access" on courses for all using (true) with check (true);
create policy "anon full access" on dept_statuses for all using (true) with check (true);
create policy "anon full access" on notifications for all using (true) with check (true);
create policy "anon full access" on room_features for all using (true) with check (true);

alter publication supabase_realtime add table rooms, courses, dept_statuses, notifications, room_features;

insert into room_features (name) values ('Projetor'), ('Mesas de Desenho');
