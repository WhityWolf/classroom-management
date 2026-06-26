-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- for a freshly created project, before running scripts/import-real-rooms.mjs.
--
-- Auth/users live entirely in plain Postgres (app_users/app_sessions +
-- security-definer functions below), not Supabase Auth — the system is meant
-- to eventually run on the university's own servers without depending on any
-- third-party proprietary service (see CLAUDE.md). Everything here is
-- portable to any Postgres instance.

create extension if not exists pgcrypto;

-- ─── Sub-unidades (substitui o antigo conjunto fixo de "departamentos") ───────
create table sub_units (
  id         text primary key,        -- slug estável, ex. 'MATH'
  name       text not null,           -- "Matemática"
  full_name  text not null,           -- "Departamento de Matemática"
  clr        text not null,           -- cor de UI (tokens usados por dtc/dbg em theme.jsx)
  text_clr   text not null,
  bg         text not null,
  light_bg   text not null,
  created_at timestamptz not null default now()
);

-- ─── Funções (substitui o antigo enum fixo ROLES) ─────────────────────────────
-- Uma função pertence a uma sub-unidade (ex. "Coordenador de Graduação" em
-- Matemática) ou é institucional (sub_unit_id null — ex. Diretor, Secretário
-- do Diretor). Salas e disciplinas pertencem à função (role_id), não à
-- sub-unidade inteira — múltiplos usuários podem ter a mesma função e
-- automaticamente compartilham as mesmas salas/permissões.
create table roles (
  id          text primary key,        -- slug estável, ex. 'MATH_GRAD_COORD'
  sub_unit_id text references sub_units(id) on delete restrict,
  name        text not null,           -- "Coordenador de Graduação"
  permissions text[] not null default '{}',  -- subconjunto de PERMS (src/auth/permissions.js)
  is_system   boolean not null default false, -- true só para a função raiz do Diretor — impede exclusão
  created_at  timestamptz not null default now()
);
create index roles_sub_unit_idx on roles(sub_unit_id);

-- ─── Blocos (NOVO — entidade própria para o "bloco" físico de uma sala, ex.
-- SG-04, PPG-Matemática, PROFMAT, dentro de um prédio/local como CCN1/CCN2).
-- Antes essa informação só existia como uma string livre concatenada em
-- rooms.building ("CCN1 — SG-04"), perdendo a granularidade que o CSV de
-- origem (scripts/data/salas-de-aula.csv, colunas LOCAL+BLOCO) já tinha.
--
-- Atenção: este nome coincide com a coluna jsonb `courses.blocks` (blocos de
-- HORÁRIO de uma disciplina, ex. {"days":["Segunda"],"sh":8,"eh":10}) — são
-- conceitos completamente não relacionados, só homônimos.
create table blocks (
  id         text primary key,        -- slug estável, ex. 'CCN1-SG-04'
  local      text not null,           -- "CCN1" (prédio/campus)
  name       text not null,           -- "SG-04", "PPG-Matemática", "PROFMAT"
  created_at timestamptz not null default now()
);

create table rooms (
  id          text primary key,
  role_id     text references roles(id) on delete restrict,  -- null = sala compartilhada/institucional
  block_id    text not null references blocks(id) on delete restrict,
  label       text not null,
  cap         integer not null,
  type        text not null,
  features    text[] not null default '{}',
  floor       integer not null,
  description text not null default ''
);
create index rooms_role_idx on rooms(role_id);
create index rooms_block_idx on rooms(block_id);

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
  role_id text not null references roles(id) on delete restrict,
  -- "2026.1"-style string (ano.período) — qual período letivo esta disciplina
  -- pertence a. Só o período mais recente (maior string, ordenação lexical
  -- já funciona pro formato ano.período) é editável; os demais são somente
  -- leitura na UI (classroom-allocation.jsx: allPeriods/currentPeriod). id
  -- inclui o período (courseId) pra não colidir entre períodos diferentes
  -- com o mesmo código+seção (a mesma disciplina se repete todo período).
  period  text not null default '2026.1',
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
create index courses_role_idx on courses(role_id);
create index courses_role_period_idx on courses(role_id, period);

-- Renomeada de dept_statuses: o status "Marcar como Concluído" agora é por
-- coordenação/função (cada coordenação de uma mesma sub-unidade conclui de
-- forma independente), não mais por sub-unidade inteira.
create table coordination_statuses (
  role_id text primary key references roles(id) on delete cascade,
  status  text not null default 'active'  -- 'active' | 'finished' | 'force_finished'
);

create table notifications (
  id         bigint generated always as identity primary key,
  role_id    text not null references roles(id) on delete cascade,
  role_name  text not null,  -- desnormalizado, como dept_name antes
  type       text not null,
  user_name  text not null,
  created_at timestamptz not null default now(),
  read       boolean not null default false
);

-- Catalog of selectable room resources (e.g. "Projetor"). Flat, no
-- categories — grows ad hoc as real needs come up (see RoomFeaturesModal in
-- classroom-allocation.jsx). Deleting an entry here doesn't retroactively
-- scrub it from rooms.features, it just stops offering it for new selections.
create table room_features (
  name text primary key
);

-- ─── Usuários (substitui o mock localStorage de src/auth/mockDb.js) ───────────
-- Sem coluna deptId singular: o escopo de um usuário vem inteiramente de
-- role_id (a função define a sub-unidade e as salas dele). Múltiplos
-- usuários podem compartilhar a mesma role_id (ex. dois secretários do
-- mesmo coordenador) e automaticamente têm as mesmas permissões/salas.
create table app_users (
  id            text primary key default ('usr_' || encode(gen_random_bytes(9), 'hex')),
  username      text not null unique,
  name          text not null,
  email         text not null unique,
  password_hash text not null,           -- bcrypt via pgcrypto crypt()/gen_salt('bf')
  role_id       text not null references roles(id) on delete restrict,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    text references app_users(id) on delete set null,
  last_login    timestamptz,
  updated_at    timestamptz
);
create index app_users_role_idx on app_users(role_id);

create table app_sessions (
  token      text primary key,
  user_id    text not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index app_sessions_user_idx on app_sessions(user_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────────
alter table sub_units enable row level security;
alter table roles enable row level security;
alter table blocks enable row level security;
alter table rooms enable row level security;
alter table courses enable row level security;
alter table coordination_statuses enable row level security;
alter table notifications enable row level security;
alter table room_features enable row level security;
alter table app_users enable row level security;
alter table app_sessions enable row level security;

-- TODO (production): replace these permissive policies with rules scoped to
-- the authenticated user's role/permissions once there's a real notion of
-- "authenticated" beyond the app_sessions token. For now, anon key has full
-- read/write access on the domain tables, matching this prototype's current
-- "no real auth enforcement" stage.
create policy "anon full access" on sub_units for all using (true) with check (true);
create policy "anon full access" on roles for all using (true) with check (true);
create policy "anon full access" on blocks for all using (true) with check (true);
create policy "anon full access" on rooms for all using (true) with check (true);
create policy "anon full access" on courses for all using (true) with check (true);
create policy "anon full access" on coordination_statuses for all using (true) with check (true);
create policy "anon full access" on notifications for all using (true) with check (true);
create policy "anon full access" on room_features for all using (true) with check (true);

-- app_users/app_sessions get NO policy at all (default deny for anon) — the
-- only access path is through the security-definer functions below, which
-- run with the function owner's privileges and bypass RLS internally. This
-- is the actual security improvement over the old mock: today anyone with
-- devtools could read cas_db_users (weak hash) directly out of localStorage;
-- here the table is never readable directly, only through controlled RPCs.

-- ─── Funções de autenticação (security definer, chamadas via supabase.rpc) ────

create or replace function create_app_user(
  p_username text, p_name text, p_email text, p_password text,
  p_role_id text, p_created_by text
) returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
declare v_id text;
begin
  if length(p_password) < 6 then
    raise exception 'A senha deve ter pelo menos 6 caracteres.';
  end if;
  if exists (select 1 from app_users u where u.username = lower(p_username)) then
    raise exception 'Nome de usuário já está em uso.';
  end if;
  if exists (select 1 from app_users u where u.email = lower(p_email)) then
    raise exception 'E-mail já está em uso.';
  end if;

  insert into app_users (username, name, email, password_hash, role_id, created_by)
  values (lower(p_username), p_name, lower(p_email), crypt(p_password, gen_salt('bf', 12)), p_role_id, p_created_by)
  returning app_users.id into v_id;

  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u where u.id = v_id;
end; $$;

create or replace function update_app_user(
  p_id text, p_name text default null, p_email text default null,
  p_password text default null, p_role_id text default null, p_is_active boolean default null
) returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_password is not null and length(p_password) < 6 then
    raise exception 'A senha deve ter pelo menos 6 caracteres.';
  end if;
  if p_email is not null and exists (select 1 from app_users u where u.email = lower(p_email) and u.id <> p_id) then
    raise exception 'E-mail já está em uso.';
  end if;

  update app_users u set
    name          = coalesce(p_name, u.name),
    email         = coalesce(lower(p_email), u.email),
    password_hash = case when p_password is not null then crypt(p_password, gen_salt('bf', 12)) else u.password_hash end,
    role_id       = coalesce(p_role_id, u.role_id),
    is_active     = coalesce(p_is_active, u.is_active),
    updated_at    = now()
  where u.id = p_id;

  if p_is_active is false then
    delete from app_sessions s where s.user_id = p_id;
  end if;

  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u where u.id = p_id;
end; $$;

create or replace function deactivate_app_user(p_id text)
returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
begin
  return query select * from update_app_user(p_id, p_is_active := false);
end; $$;

create or replace function list_app_users()
returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u order by u.name;
end; $$;

create or replace function authenticate_app_user(p_username text, p_password text)
returns table (
  token text, id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
declare v_user app_users; v_token text;
begin
  select * into v_user from app_users u where u.username = lower(p_username);
  if v_user.id is null or not v_user.is_active then return; end if;
  if crypt(p_password, v_user.password_hash) <> v_user.password_hash then return; end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app_sessions (token, user_id, expires_at) values (v_token, v_user.id, now() + interval '8 hours');
  update app_users u set last_login = now() where u.id = v_user.id;

  return query
    select v_token, u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, now(), u.updated_at
    from app_users u where u.id = v_user.id;
end; $$;

create or replace function validate_app_session(p_token text)
returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
declare v_session app_sessions;
begin
  select * into v_session from app_sessions s where s.token = p_token;
  if v_session.token is null then return; end if;
  if v_session.expires_at <= now() then
    delete from app_sessions s where s.token = p_token;
    return;
  end if;

  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u where u.id = v_session.user_id and u.is_active;
end; $$;

create or replace function revoke_app_session(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from app_sessions s where s.token = p_token;
end; $$;

create or replace function delete_app_user(p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from app_users where id = p_id;
end; $$;

revoke all on function create_app_user(text,text,text,text,text,text) from public;
revoke all on function update_app_user(text,text,text,text,text,boolean) from public;
revoke all on function deactivate_app_user(text) from public;
revoke all on function delete_app_user(text) from public;
revoke all on function list_app_users() from public;
revoke all on function authenticate_app_user(text,text) from public;
revoke all on function validate_app_session(text) from public;
revoke all on function revoke_app_session(text) from public;

grant execute on function create_app_user(text,text,text,text,text,text) to anon;
grant execute on function update_app_user(text,text,text,text,text,boolean) to anon;
grant execute on function deactivate_app_user(text) to anon;
grant execute on function delete_app_user(text) to anon;
grant execute on function list_app_users() to anon;
grant execute on function authenticate_app_user(text,text) to anon;
grant execute on function validate_app_session(text) to anon;
grant execute on function revoke_app_session(text) to anon;

-- ─── Realtime ──────────────────────────────────────────────────────────────────
-- app_users/app_sessions intentionally NOT added here — the user list is
-- loaded on demand (list_app_users()), no live-sync need, and it avoids
-- broadcasting user metadata over a wider channel than necessary.
alter publication supabase_realtime add table
  sub_units, roles, blocks, rooms, courses, coordination_statuses, notifications, room_features;

insert into room_features (name) values ('Projetor'), ('Mesas de Desenho');
