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
  sec     integer not null,
  dept_id text not null,
  days    text[] not null,
  sh      integer not null,
  eh      integer not null,
  enroll  integer not null,
  room    text references rooms(id) on delete set null
);
create index courses_room_idx on courses(room);
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

alter table rooms enable row level security;
alter table courses enable row level security;
alter table dept_statuses enable row level security;
alter table notifications enable row level security;

-- TODO (production): replace these permissive policies with rules scoped to
-- the authenticated user's role/dept once real Supabase Auth is wired up to
-- the role model in src/auth/*. For now, anon key has full read/write access,
-- matching this prototype's current "no real auth enforcement" stage.
create policy "anon full access" on rooms for all using (true) with check (true);
create policy "anon full access" on courses for all using (true) with check (true);
create policy "anon full access" on dept_statuses for all using (true) with check (true);
create policy "anon full access" on notifications for all using (true) with check (true);

alter publication supabase_realtime add table rooms, courses, dept_statuses, notifications;
