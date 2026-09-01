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
  is_active  boolean not null default true, -- flag administrativa (mesmo padrão de app_users.is_active) — não altera nada fora de Gerenciamento; só precisa estar false para permitir excluir
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
  is_active  boolean not null default true, -- flag administrativa (ver sub_units.is_active) — precisa estar false pra permitir excluir
  created_at timestamptz not null default now(),
  -- Posição do pino no Mapa do Campus, em porcentagem da largura/altura da
  -- imagem (0-100, não pixel) — assim continua válido em qualquer
  -- resolução/tamanho de tela, mesmo se a imagem for trocada por uma
  -- versão maior depois. null = bloco ainda não posicionado no mapa.
  map_x      numeric(5,2),
  map_y      numeric(5,2)
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
  description text not null default '',
  is_active   boolean not null default true -- flag administrativa (ver sub_units.is_active) — precisa estar false pra permitir excluir
);
create index rooms_role_idx on rooms(role_id);
create index rooms_block_idx on rooms(block_id);

-- ─── Períodos letivos (NOVO) ────────────────────────────────────────────────
-- Antes um período letivo só existia implicitamente por ser referenciado em
-- pelo menos uma linha de courses.period (ou, transitoriamente dentro de uma
-- sessão, por Dashboard.createdPeriods em memória, no client) — um período
-- recém-criado sem nenhuma disciplina cadastrada desaparecia assim que a
-- página recarregava ou ninguém mais estava olhando pra ele. Esta tabela
-- torna o período uma entidade persistida por si só, existindo
-- independentemente de ter ou não disciplinas.
-- courses.period continua sendo uma coluna text livre (não uma FK pra cá) —
-- mesmo "soft reference" já usado em outros lugares deste schema (ex.
-- room_by_day não referencia rooms via FK de verdade) — pra não travar em
-- dados legados cujo período ainda não tenha uma linha correspondente aqui.
create table periods (
  id         text primary key,  -- "AAAA.N", mesmo formato/valor usado em courses.period
  created_at timestamptz not null default now()
);
insert into periods (id) values ('2026.1');

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

-- ─── Configurações globais (singleton) ────────────────────────────────────
-- Uma única linha guarda overrides globais visíveis a todos os usuários.
-- current_period_override null = comportamento automático (maior período
-- por comparePeriods, ver src/periods.js); um valor força esse período como
-- "atual" independente do que os cursos tenham.
create table app_settings (
  id                      text primary key default 'singleton',
  current_period_override text
);
insert into app_settings (id) values ('singleton');

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
  updated_at    timestamptz,
  -- Controle de força bruta (ver authenticate_app_user) — bloqueia a CONTA
  -- por 15min depois de 5 senhas erradas seguidas; zera em qualquer login
  -- bem-sucedido.
  failed_logins int not null default 0,
  locked_until  timestamptz
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
alter table app_settings enable row level security;
alter table periods enable row level security;
alter table app_users enable row level security;
alter table app_sessions enable row level security;

-- TODO (production): replace these permissive policies with rules scoped to
-- the authenticated user's role/permissions once there's a real notion of
-- "authenticated" beyond the app_sessions token. For now, anon key has full
-- read/write access on the domain tables, matching this prototype's current
-- "no real auth enforcement" stage.
-- Só leitura direta (SELECT) é liberada pra `anon` nestas tabelas — escrita
-- (INSERT/UPDATE/DELETE) foi revogada logo abaixo, então só as funções
-- security definer (que rodam como o dono da tabela, ignorando GRANT/RLS)
-- conseguem gravar. Antes disso, `using (true) for all` (leitura E escrita)
-- somado ao GRANT padrão de INSERT/UPDATE/DELETE que o Supabase concede a
-- `anon` por tabela deixava qualquer cliente com a chave anônima (pública,
-- embutida no bundle do frontend) escrever qualquer coisa em qualquer
-- tabela de domínio sem checagem nenhuma de permissão.
create policy "anon read access" on sub_units for select using (true);
create policy "anon read access" on roles for select using (true);
create policy "anon read access" on blocks for select using (true);
create policy "anon read access" on rooms for select using (true);
create policy "anon read access" on courses for select using (true);
create policy "anon read access" on coordination_statuses for select using (true);
create policy "anon read access" on notifications for select using (true);
create policy "anon read access" on room_features for select using (true);
create policy "anon read access" on app_settings for select using (true);
create policy "anon read access" on periods for select using (true);

revoke insert, update, delete on
  sub_units, roles, blocks, rooms, courses, coordination_statuses,
  notifications, room_features, app_settings, periods
from anon;

-- app_users/app_sessions get NO policy at all (default deny for anon) — the
-- only access path is through the security-definer functions below, which
-- run with the function owner's privileges and bypass RLS internally. This
-- is the actual security improvement over the old mock: today anyone with
-- devtools could read cas_db_users (weak hash) directly out of localStorage;
-- here the table is never readable directly, only through controlled RPCs.

-- Bootstrap: cria o primeiro usuário/Diretor de um projeto novo. Roda só
-- uma vez, manualmente, direto no SQL Editor do Supabase (conectado como
-- postgres/supabase_admin, não como anon) — por isso, ao contrário de toda
-- função abaixo, ela NÃO recebe token de sessão nem é liberada pra `anon`:
-- ainda não existe usuário nenhum nesse ponto, então não haveria sessão
-- válida pra checar (create_app_user normal exige CREATE_ANY_USER, que
-- exige estar logado, que exige um usuário já existir — o primeiro usuário
-- não tem como nascer por esse caminho). Recusa rodar se já existir
-- qualquer usuário, então não dá pra usar isto pra criar uma segunda conta
-- goela abaixo depois que o projeto já está no ar.
create or replace function bootstrap_admin_user(p_username text, p_name text, p_email text, p_password text, p_role_id text)
returns table (id text, username text) language plpgsql security definer set search_path = public, extensions as $$
declare v_id text;
begin
  if exists (select 1 from app_users) then
    raise exception 'Já existem usuários — use create_app_user (via RPC autenticado, dentro do app) pra criar novos, não esta função.';
  end if;
  insert into app_users (username, name, email, password_hash, role_id)
  values (lower(p_username), p_name, lower(p_email), crypt(p_password, gen_salt('bf', 12)), p_role_id)
  returning app_users.id into v_id;
  return query select u.id, u.username from app_users u where u.id = v_id;
end; $$;

revoke all on function bootstrap_admin_user(text,text,text,text,text) from public;
-- Sem "grant execute ... to anon" de propósito — só quem tem acesso direto
-- ao Postgres (SQL Editor) consegue chamar isto, nunca o app pelo browser.

-- ─── Funções de autenticação (security definer, chamadas via supabase.rpc)
-- ────────────────────────────────────────────────────────────────────────────
-- Autenticação em Postgres puro (sem Supabase Auth) — ver README.md. Todas
-- as mutações de domínio abaixo (sub-unidades, funções, blocos, salas,
-- disciplinas, períodos, coordenação, usuários) recebem um token de sessão
-- (`p_token`, o mesmo token que authenticate_app_user devolve no login) e
-- validam ele + a permissão certa ANTES de escrever, através dos helpers
-- logo abaixo. As tabelas de domínio têm INSERT/UPDATE/DELETE revogados de
-- `anon` no fim deste arquivo — só estas funções conseguem escrever nelas.
-- Antes, qualquer cliente com a chave anônima (pública, embutida no
-- bundle do frontend) podia escrever direto nas tabelas sem checagem
-- nenhuma; e as próprias funções de usuário abaixo, mesmo já sendo
-- security definer, não verificavam quem estava chamando.

-- ═══ Lote 4: funções de usuário — já eram security definer, mas nenhuma
-- delas checava QUEM estava chamando. Qualquer cliente com a chave anônima
-- podia criar um usuário Diretor pra si mesmo, editar/desativar/excluir
-- qualquer conta. Este lote fecha isso — mesmo padrão de token+permissão
-- dos outros lotes, mais proteção extra pro usuário 'admin' (isSystemUser
-- no cliente) e contra se auto-desativar/auto-excluir. ═══════════════════


create or replace function create_app_user(
  p_token text, p_username text, p_name text, p_email text, p_password text, p_role_id text
) returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
declare v_caller_id text; v_id text;
begin
  v_caller_id := auth_user_id(p_token);
  perform require_permission(p_token, 'CREATE_ANY_USER');

  if length(p_password) < 6 then
    raise exception 'A senha deve ter pelo menos 6 caracteres.';
  end if;
  if exists (select 1 from app_users u where u.username = lower(p_username)) then
    raise exception 'Nome de usuário já está em uso.';
  end if;
  if exists (select 1 from app_users u where u.email = lower(p_email)) then
    raise exception 'E-mail já está em uso.';
  end if;

  -- created_by vem da própria sessão, nunca de um valor mandado pelo
  -- cliente (antes dava pra qualquer um se declarar "criado por" outra
  -- pessoa, inclusive alguém que nem existe).
  insert into app_users (username, name, email, password_hash, role_id, created_by)
  values (lower(p_username), p_name, lower(p_email), crypt(p_password, gen_salt('bf', 12)), p_role_id, v_caller_id)
  returning app_users.id into v_id;

  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u where u.id = v_id;
end; $$;

create or replace function update_app_user(
  p_token text, p_id text, p_name text default null, p_email text default null,
  p_password text default null, p_role_id text default null, p_is_active boolean default null
) returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'EDIT_ANY_USER');

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

-- Desativar: exige DEACTIVATE_USER, bloqueia auto-desativação e o usuário
-- 'admin' (mesmas duas regras que já existiam só no cliente — isSystemUser
-- + "u.id !== currentUser.id" em ManagementScreen.jsx).
create or replace function deactivate_app_user(p_token text, p_id text)
returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
declare v_caller_id text; v_username text;
begin
  perform require_permission(p_token, 'DEACTIVATE_USER');
  v_caller_id := auth_user_id(p_token);
  if v_caller_id = p_id then
    raise exception 'Você não pode desativar sua própria conta.' using errcode = '42501';
  end if;
  select u.username into v_username from app_users u where u.id = p_id;
  if v_username = 'admin' then
    raise exception 'Esta conta é protegida e não pode ser desativada.' using errcode = '42501';
  end if;

  -- UPDATE direto (não delega pra update_app_user) porque essa outra
  -- função exige EDIT_ANY_USER — uma permissão diferente de
  -- DEACTIVATE_USER, que já foi checada acima. Empilhar as duas faria
  -- alguém com só DEACTIVATE_USER (sem EDIT_ANY_USER) ser barrado aqui por
  -- uma permissão que nem deveria precisar.
  update app_users set is_active = false, updated_at = now() where app_users.id = p_id;
  delete from app_sessions where app_sessions.user_id = p_id;

  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u where u.id = p_id;
end; $$;

create or replace function list_app_users(p_token text)
returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Ver a lista de usuários é, na prática, a própria tela de Gerenciamento
  -- (aba Usuários e Funções) — exige qualquer uma das permissões que já
  -- davam acesso a essa aba (mesmo "anyPerm" usado pra mostrar a aba no
  -- cliente), não uma sessão qualquer.
  if not exists (
    select 1 from roles r where r.id = auth_role_id(p_token)
      and ('CREATE_ANY_USER' = any(r.permissions) or 'EDIT_ANY_USER' = any(r.permissions)
        or 'DEACTIVATE_USER' = any(r.permissions) or 'DELETE_USER' = any(r.permissions)
        or 'MANAGE_ROLES' = any(r.permissions))
  ) then
    perform require_session(p_token); -- token inválido -> mensagem de sessão, não de permissão
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u order by u.name;
end; $$;

create or replace function delete_app_user(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_caller_id text; v_username text;
begin
  perform require_permission(p_token, 'DELETE_USER');
  v_caller_id := auth_user_id(p_token);
  if v_caller_id = p_id then
    raise exception 'Você não pode excluir sua própria conta.' using errcode = '42501';
  end if;
  select u.username into v_username from app_users u where u.id = p_id;
  if v_username = 'admin' then
    raise exception 'Esta conta é protegida e não pode ser excluída.' using errcode = '42501';
  end if;
  delete from app_users where id = p_id;
end; $$;

-- Login e validação/revogação de sessão não recebem p_token nem checam
-- permissão — são o próprio mecanismo que EMITE o token que todas as
-- outras funções deste arquivo passam a exigir. Continuam exatamente como
-- antes desta revisão, exceto authenticate_app_user, que ganhou bloqueio
-- por força bruta (ver comentário abaixo).

-- Bloqueia a CONTA (não o IP) por 15 minutos depois de 5 senhas erradas
-- seguidas — protege contra força bruta sem depender de um header de IP
-- que um proxy mal configurado poderia falsificar. O contador zera em
-- qualquer login bem-sucedido.
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

  if v_user.locked_until is not null and v_user.locked_until > now() then
    raise exception 'Muitas tentativas incorretas. Tente novamente em alguns minutos.' using errcode = '28000';
  end if;

  if crypt(p_password, v_user.password_hash) <> v_user.password_hash then
    update app_users u set
      failed_logins = u.failed_logins + 1,
      locked_until = case when u.failed_logins + 1 >= 5 then now() + interval '15 minutes' else u.locked_until end
    where u.id = v_user.id;
    return;
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app_sessions (token, user_id, expires_at) values (v_token, v_user.id, now() + interval '8 hours');
  update app_users u set last_login = now(), failed_logins = 0, locked_until = null where u.id = v_user.id;

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

-- Autoatendimento: qualquer usuário logado troca a PRÓPRIA senha (não exige
-- EDIT_ANY_USER — essa permissão é pra editar OUTRAS contas; sem esta
-- função, só quem já tinha EDIT_ANY_USER conseguia trocar senha, e chefes/
-- coordenadores normalmente não têm). Exige a senha atual pra confirmar
-- identidade — defesa extra: um token roubado sozinho não basta pra trocar
-- a senha e trancar o dono de fora.
create or replace function change_own_password(p_token text, p_current_password text, p_new_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_user_id text; v_hash text;
begin
  perform require_session(p_token); -- só valida; levanta exceção se inválido/expirado
  v_user_id := auth_user_id(p_token);

  if length(p_new_password) < 6 then
    raise exception 'A nova senha deve ter pelo menos 6 caracteres.';
  end if;

  select password_hash into v_hash from app_users where id = v_user_id;
  if crypt(p_current_password, v_hash) <> v_hash then
    raise exception 'Senha atual incorreta.' using errcode = '28000';
  end if;

  update app_users set password_hash = crypt(p_new_password, gen_salt('bf', 12)), updated_at = now()
  where id = v_user_id;
end; $$;

-- Autoatendimento: a própria tela de Perfil precisa reler os dados do
-- usuário logado (ex. depois de trocar o nome) sem exigir nenhuma das
-- permissões de gerenciamento que list_app_users pede — sem esta função,
-- AuthContext.refreshUser() só funcionava pra quem já tinha EDIT_ANY_USER/
-- CREATE_ANY_USER/etc. (só nunca foi notado porque só era chamada de dentro
-- de UserManagement, que já exige uma dessas permissões pra abrir).
create or replace function whoami(p_token text)
returns table (
  id text, username text, name text, email text, role_id text,
  is_active boolean, created_at timestamptz, created_by text,
  last_login timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public, extensions as $$
declare v_user_id text;
begin
  v_user_id := auth_user_id(p_token);
  perform require_session(p_token); -- só valida; levanta exceção se inválido/expirado
  return query
    select u.id, u.username, u.name, u.email, u.role_id, u.is_active, u.created_at, u.created_by, u.last_login, u.updated_at
    from app_users u where u.id = v_user_id;
end; $$;

-- Autoatendimento: qualquer usuário logado troca o PRÓPRIO nome — outros
-- campos (usuário, e-mail, função) continuam exigindo EDIT_ANY_USER (tela
-- de Perfil informa que essas mudanças passam pela Diretoria).
create or replace function change_own_name(p_token text, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_user_id text;
begin
  v_user_id := auth_user_id(p_token);
  perform require_session(p_token);
  if trim(p_name) = '' then
    raise exception 'Informe um nome.';
  end if;
  update app_users set name = trim(p_name), updated_at = now() where id = v_user_id;
end; $$;

revoke all on function create_app_user(text,text,text,text,text,text) from public;
revoke all on function update_app_user(text,text,text,text,text,text,boolean) from public;
revoke all on function deactivate_app_user(text,text) from public;
revoke all on function delete_app_user(text,text) from public;
revoke all on function list_app_users(text) from public;
revoke all on function authenticate_app_user(text,text) from public;
revoke all on function validate_app_session(text) from public;
revoke all on function revoke_app_session(text) from public;
revoke all on function change_own_password(text,text,text) from public;
revoke all on function whoami(text) from public;
revoke all on function change_own_name(text,text) from public;

grant execute on function create_app_user(text,text,text,text,text,text) to anon;
grant execute on function update_app_user(text,text,text,text,text,text,boolean) to anon;
grant execute on function deactivate_app_user(text,text) to anon;
grant execute on function delete_app_user(text,text) to anon;
grant execute on function list_app_users(text) to anon;
grant execute on function authenticate_app_user(text,text) to anon;
grant execute on function validate_app_session(text) to anon;
grant execute on function revoke_app_session(text) to anon;
grant execute on function change_own_password(text,text,text) to anon;
grant execute on function whoami(text) to anon;
grant execute on function change_own_name(text,text) to anon;

-- ═══ Lote 1: helpers de autorização ═══════════════════════════════════════

create or replace function auth_user_id(p_token text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select u.id from app_sessions s join app_users u on u.id = s.user_id
  where s.token = p_token and s.expires_at > now() and u.is_active;
$$;

create or replace function auth_role_id(p_token text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select u.role_id from app_sessions s join app_users u on u.id = s.user_id
  where s.token = p_token and s.expires_at > now() and u.is_active;
$$;

create or replace function require_session(p_token text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text;
begin
  v_role_id := auth_role_id(p_token);
  if v_role_id is null then
    raise exception 'Sessão inválida ou expirada. Faça login novamente.' using errcode = '28000';
  end if;
  return v_role_id;
end; $$;

create or replace function require_permission(p_token text, p_permission text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text;
begin
  v_role_id := require_session(p_token);
  if not exists (select 1 from roles where id = v_role_id and p_permission = any(permissions)) then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  return v_role_id;
end; $$;

create or replace function is_institutional_role(p_role_id text) returns boolean
language sql stable as $$
  select exists (select 1 from roles where id = p_role_id and sub_unit_id is null);
$$;

create or replace function require_institutional(p_token text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text;
begin
  v_role_id := require_session(p_token);
  if not is_institutional_role(v_role_id) then
    raise exception 'Ação restrita a funções institucionais.' using errcode = '42501';
  end if;
  return v_role_id;
end; $$;

-- Maior período (comparação numérica ano.período, não alfabética) entre os
-- persistidos em `periods`, ou o override fixado em app_settings se houver.
create or replace function current_period_id() returns text
language sql stable as $$
  select coalesce(
    (select current_period_override from app_settings where id = 'singleton'),
    (select id from periods
       order by split_part(id,'.',1)::int desc, split_part(id,'.',2)::int desc
       limit 1)
  );
$$;

-- Réplica de canAllocate/canDealloc/canEditCourse (classroom-allocation.jsx):
-- não-institucional só pode mexer em disciplinas do período mais recente
-- (institucional pode em qualquer período), e só enquanto sua própria
-- coordenação estiver com status 'active' (institucional nunca é travado
-- por isso — não tem linha própria em coordination_statuses).
create or replace function require_can_allocate(p_token text, p_course_period text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role_id text;
  v_is_inst boolean;
  v_status  text;
begin
  v_role_id := require_session(p_token);
  v_is_inst := is_institutional_role(v_role_id);

  if not v_is_inst then
    select coalesce((select status from coordination_statuses where role_id = v_role_id), 'active') into v_status;
    if v_status <> 'active' then
      raise exception 'Sua coordenação já foi concluída — peça pra Diretoria reabrir antes de continuar.' using errcode = '42501';
    end if;
    if p_course_period <> current_period_id() then
      raise exception 'Período encerrado — somente leitura.' using errcode = '42501';
    end if;
  end if;

  return v_role_id;
end; $$;

revoke all on function auth_user_id(text) from public;
revoke all on function auth_role_id(text) from public;
revoke all on function require_session(text) from public;
revoke all on function require_permission(text,text) from public;
revoke all on function is_institutional_role(text) from public;
revoke all on function require_institutional(text) from public;
revoke all on function current_period_id() from public;
revoke all on function require_can_allocate(text,text) from public;
-- Só chamadas via supabase.rpc a partir dos outros functions (não precisam
-- ser exportadas pro cliente diretamente), mas grant pra authenticated
-- também não faz mal — nenhuma delas expõe dado sensível sozinha.
grant execute on function auth_user_id(text) to anon;
grant execute on function auth_role_id(text) to anon;
grant execute on function require_session(text) to anon;
grant execute on function require_permission(text,text) to anon;
grant execute on function is_institutional_role(text) to anon;
grant execute on function require_institutional(text) to anon;
grant execute on function current_period_id() to anon;
grant execute on function require_can_allocate(text,text) to anon;

-- ═══ Lote 2: CRUD de domínio (sub-unidades, funções, blocos, salas, features,
-- períodos) — cada mutação agora exige token de sessão + a permissão que a UI
-- já checava antes de mostrar o botão (client-side apenas até aqui) ══════════


-- ─── Sub-unidades (MANAGE_SUB_UNITS) ────────────────────────────────────────
create or replace function create_sub_unit(
  p_token text, p_id text, p_name text, p_full_name text,
  p_clr text, p_text_clr text, p_bg text, p_light_bg text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_SUB_UNITS');
  insert into sub_units (id, name, full_name, clr, text_clr, bg, light_bg)
  values (p_id, p_name, p_full_name, p_clr, p_text_clr, p_bg, p_light_bg);
end; $$;

-- Assinatura mudou (novo p_is_active no final) — precisa dropar a versão
-- antiga antes, senão "create or replace" cria uma segunda função
-- sobrecarregada em vez de substituir a existente.
drop function if exists update_sub_unit(text,text,text,text,text,text,text,text);
create or replace function update_sub_unit(
  p_token text, p_id text, p_name text default null, p_full_name text default null,
  p_clr text default null, p_text_clr text default null, p_bg text default null, p_light_bg text default null,
  p_is_active boolean default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_SUB_UNITS');
  update sub_units set
    name = coalesce(p_name, name), full_name = coalesce(p_full_name, full_name),
    clr = coalesce(p_clr, clr), text_clr = coalesce(p_text_clr, text_clr),
    bg = coalesce(p_bg, bg), light_bg = coalesce(p_light_bg, light_bg),
    is_active = coalesce(p_is_active, is_active)
  where id = p_id;
end; $$;

create or replace function delete_sub_unit(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_SUB_UNITS');
  delete from sub_units where id = p_id;
end; $$;

-- ─── Funções (MANAGE_ROLES) ─────────────────────────────────────────────────
create or replace function create_role(
  p_token text, p_id text, p_sub_unit_id text, p_name text, p_permissions text[]
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROLES');
  insert into roles (id, sub_unit_id, name, permissions) values (p_id, p_sub_unit_id, p_name, p_permissions);
end; $$;

create or replace function update_role(
  p_token text, p_id text, p_sub_unit_id text default null, p_name text default null,
  p_permissions text[] default null, p_clear_sub_unit_id boolean default false
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROLES');
  update roles set
    sub_unit_id = case when p_clear_sub_unit_id then null else coalesce(p_sub_unit_id, sub_unit_id) end,
    name = coalesce(p_name, name),
    permissions = coalesce(p_permissions, permissions)
  where id = p_id;
end; $$;

-- Apaga as disciplinas da função e a função em si, numa única transação —
-- se ainda houver salas/usuários vinculados, a FK restrict rejeita o delete
-- de roles e o Postgres desfaz o delete de courses acima também.
create or replace function delete_role_and_courses(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROLES');
  delete from courses where role_id = p_id;
  delete from roles where id = p_id;
end; $$;

-- ─── Blocos (MANAGE_BLOCKS) ─────────────────────────────────────────────────
create or replace function create_block(p_token text, p_id text, p_local text, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_BLOCKS');
  insert into blocks (id, local, name) values (p_id, p_local, p_name);
end; $$;

drop function if exists update_block(text,text,text,text);
create or replace function update_block(p_token text, p_id text, p_local text default null, p_name text default null, p_is_active boolean default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_BLOCKS');
  update blocks set local = coalesce(p_local, local), name = coalesce(p_name, name), is_active = coalesce(p_is_active, is_active) where id = p_id;
end; $$;

create or replace function delete_block(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_BLOCKS');
  delete from blocks where id = p_id;
end; $$;

-- Posição do pino no Mapa do Campus. p_x/p_y null = "desmarcar" (bloco
-- volta a aparecer como "sem posição"), não precisa de uma função
-- separada só pra limpar.
create or replace function set_block_position(p_token text, p_id text, p_x numeric, p_y numeric)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_BLOCKS');
  if p_x is not null and (p_x < 0 or p_x > 100) then
    raise exception 'Posição X fora do intervalo (0-100).';
  end if;
  if p_y is not null and (p_y < 0 or p_y > 100) then
    raise exception 'Posição Y fora do intervalo (0-100).';
  end if;
  update blocks set map_x = p_x, map_y = p_y where id = p_id;
end; $$;

-- ─── Salas (MANAGE_ROOMS — update_room também aceita MANAGE_ROLES, porque a
-- aba Funções usa esta mesma mutação pra alternar "esta sala pertence a
-- este papel", uma ação de dono de sala que hoje já é alcançável só com
-- MANAGE_ROLES sem precisar abrir a aba Salas e Blocos) ─────────────────────
create or replace function create_room(
  p_token text, p_id text, p_role_id text, p_block_id text, p_label text,
  p_cap int, p_type text, p_floor int, p_features text[], p_description text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROOMS');
  insert into rooms (id, role_id, block_id, label, cap, type, floor, features, description)
  values (p_id, p_role_id, p_block_id, p_label, p_cap, p_type, p_floor, coalesce(p_features,'{}'), coalesce(p_description,''));
end; $$;

drop function if exists update_room(text,text,text,boolean,text,text,int,text,int,text[],text);
create or replace function update_room(
  p_token text, p_id text, p_role_id text default null, p_clear_role_id boolean default false,
  p_block_id text default null, p_label text default null, p_cap int default null,
  p_type text default null, p_floor int default null, p_features text[] default null, p_description text default null,
  p_is_active boolean default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text;
begin
  v_role_id := require_session(p_token);
  if not exists (select 1 from roles where id = v_role_id and ('MANAGE_ROOMS' = any(permissions) or 'MANAGE_ROLES' = any(permissions))) then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  update rooms set
    role_id = case when p_clear_role_id then null else coalesce(p_role_id, role_id) end,
    block_id = coalesce(p_block_id, block_id), label = coalesce(p_label, label),
    cap = coalesce(p_cap, cap), type = coalesce(p_type, type), floor = coalesce(p_floor, floor),
    features = coalesce(p_features, features), description = coalesce(p_description, description),
    is_active = coalesce(p_is_active, is_active)
  where id = p_id;
end; $$;

-- room_by_day é jsonb, sem FK real pra rooms (soft reference). Limpa, na
-- mesma transação, os dias em que a sala excluída estava em uso — nunca
-- deixa uma disciplina apontando pra um id de sala que não existe mais.
-- Retorna quantas disciplinas foram afetadas.
create or replace function delete_room_and_unallocate(p_token text, p_id text) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare v_count integer;
begin
  perform require_permission(p_token, 'MANAGE_ROOMS');
  with affected as (
    update courses c
    set room_by_day = (
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      from jsonb_each(c.room_by_day) e
      where e.value <> to_jsonb(p_id)
    )
    where exists (select 1 from jsonb_each_text(c.room_by_day) e2 where e2.value = p_id)
    returning c.id
  )
  select count(*) into v_count from affected;
  delete from rooms where id = p_id;
  return v_count;
end; $$;

create or replace function save_room_features(p_token text, p_room_id text, p_features text[], p_description text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROOMS');
  update rooms set features = coalesce(p_features,'{}'), description = coalesce(p_description,'') where id = p_room_id;
end; $$;

create or replace function add_feature_option(p_token text, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROOMS');
  insert into room_features (name) values (p_name);
end; $$;

create or replace function remove_feature_option(p_token text, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_ROOMS');
  delete from room_features where name = p_name;
end; $$;

-- ─── Períodos (institucional — não tem PERMS.* dedicado, mesma regra que já
-- gate a visibilidade da aba Períodos: `isInstitutional`) ───────────────────
create or replace function create_period(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_institutional(p_token);
  insert into periods (id) values (p_id);
end; $$;

create or replace function delete_period_and_courses(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_institutional(p_token);
  delete from courses where period = p_id;
  delete from periods where id = p_id;
  update app_settings set current_period_override = null
    where id = 'singleton' and current_period_override = p_id;
end; $$;

create or replace function set_current_period_override(p_token text, p_period text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_institutional(p_token);
  update app_settings set current_period_override = p_period where id = 'singleton';
end; $$;

revoke all on function create_sub_unit(text,text,text,text,text,text,text,text) from public;
revoke all on function update_sub_unit(text,text,text,text,text,text,text,text,boolean) from public;
revoke all on function delete_sub_unit(text,text) from public;
revoke all on function create_role(text,text,text,text,text[]) from public;
revoke all on function update_role(text,text,text,text,text[],boolean) from public;
revoke all on function delete_role_and_courses(text,text) from public;
revoke all on function create_block(text,text,text,text) from public;
revoke all on function update_block(text,text,text,text,boolean) from public;
revoke all on function delete_block(text,text) from public;
revoke all on function set_block_position(text,text,numeric,numeric) from public;
revoke all on function create_room(text,text,text,text,text,int,text,int,text[],text) from public;
revoke all on function update_room(text,text,text,boolean,text,text,int,text,int,text[],text,boolean) from public;
revoke all on function delete_room_and_unallocate(text,text) from public;
revoke all on function save_room_features(text,text,text[],text) from public;
revoke all on function add_feature_option(text,text) from public;
revoke all on function remove_feature_option(text,text) from public;
revoke all on function create_period(text,text) from public;
revoke all on function delete_period_and_courses(text,text) from public;
revoke all on function set_current_period_override(text,text) from public;

grant execute on function create_sub_unit(text,text,text,text,text,text,text,text) to anon;
grant execute on function update_sub_unit(text,text,text,text,text,text,text,text,boolean) to anon;
grant execute on function delete_sub_unit(text,text) to anon;
grant execute on function create_role(text,text,text,text,text[]) to anon;
grant execute on function update_role(text,text,text,text,text[],boolean) to anon;
grant execute on function delete_role_and_courses(text,text) to anon;
grant execute on function create_block(text,text,text,text) to anon;
grant execute on function update_block(text,text,text,text,boolean) to anon;
grant execute on function delete_block(text,text) to anon;
grant execute on function set_block_position(text,text,numeric,numeric) to anon;
grant execute on function create_room(text,text,text,text,text,int,text,int,text[],text) to anon;
grant execute on function update_room(text,text,text,boolean,text,text,int,text,int,text[],text,boolean) to anon;
grant execute on function delete_room_and_unallocate(text,text) to anon;
grant execute on function save_room_features(text,text,text[],text) to anon;
grant execute on function add_feature_option(text,text) to anon;
grant execute on function remove_feature_option(text,text) to anon;
grant execute on function create_period(text,text) to anon;
grant execute on function delete_period_and_courses(text,text) to anon;
grant execute on function set_current_period_override(text,text) to anon;

-- ═══ Lote 3: disciplinas, alocação, coordenação, notificações ═════════════

-- Réplica de canManageCatalog (=canAllocate): institucional cria pra
-- qualquer função; não-institucional só pra sua própria função (mesmo sem
-- FK impedir isso hoje, era só a UI que nunca oferecia a opção — um cliente
-- malicioso podia mandar um role_id alheio direto pra tabela antes disto).
create or replace function create_course(
  p_token text, p_id text, p_code text, p_name text, p_sec int,
  p_role_id text, p_period text, p_teacher text, p_blocks jsonb, p_enroll int
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text; v_is_inst boolean;
begin
  v_role_id := require_can_allocate(p_token, p_period);
  v_is_inst := is_institutional_role(v_role_id);
  if not v_is_inst and v_role_id <> p_role_id then
    raise exception 'Só é possível criar disciplinas para a própria função.' using errcode = '42501';
  end if;
  insert into courses (id, code, name, sec, role_id, period, teacher, blocks, enroll, room_by_day)
  values (p_id, p_code, p_name, p_sec, p_role_id, p_period, coalesce(p_teacher,''), coalesce(p_blocks,'[]'), p_enroll, '{}');
end; $$;

-- editCourse/deleteCourse nunca trocam o role_id — a checagem de dono usa o
-- role_id JÁ GRAVADO na disciplina (lido antes de qualquer alteração).
create or replace function edit_course(
  p_token text, p_id text, p_code text default null, p_sec int default null, p_name text default null,
  p_teacher text default null, p_blocks jsonb default null, p_enroll int default null, p_room_by_day jsonb default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text; v_course courses;
begin
  select * into v_course from courses where id = p_id;
  if v_course.id is null then raise exception 'Disciplina não encontrada.'; end if;
  v_role_id := require_can_allocate(p_token, v_course.period);
  if not is_institutional_role(v_role_id) and v_role_id <> v_course.role_id then
    raise exception 'Só é possível editar disciplinas da própria função.' using errcode = '42501';
  end if;
  update courses set
    code = coalesce(p_code, code), sec = coalesce(p_sec, sec), name = coalesce(p_name, name),
    teacher = coalesce(p_teacher, teacher), blocks = coalesce(p_blocks, blocks),
    enroll = coalesce(p_enroll, enroll), room_by_day = coalesce(p_room_by_day, room_by_day)
  where id = p_id;
end; $$;

create or replace function delete_course(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text; v_course courses;
begin
  select * into v_course from courses where id = p_id;
  if v_course.id is null then return; end if; -- já não existe, idempotente
  v_role_id := require_can_allocate(p_token, v_course.period);
  if not is_institutional_role(v_role_id) and v_role_id <> v_course.role_id then
    raise exception 'Só é possível excluir disciplinas da própria função.' using errcode = '42501';
  end if;
  delete from courses where id = p_id;
end; $$;

-- Importação em massa (CSV/ODS) — substitui TODAS as disciplinas de
-- role_id+period pelo novo conjunto, numa única transação (a versão anterior
-- em duas chamadas do cliente podia deixar a função+período vazio se o
-- insert falhasse depois do delete ter sido aplicado).
create or replace function replace_role_courses(p_token text, p_role_id text, p_period text, p_courses jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text;
begin
  v_role_id := require_can_allocate(p_token, p_period);
  if not is_institutional_role(v_role_id) and v_role_id <> p_role_id then
    raise exception 'Só é possível importar disciplinas para a própria função.' using errcode = '42501';
  end if;

  delete from courses where role_id = p_role_id and period = p_period;

  insert into courses (id, code, name, sec, role_id, period, teacher, blocks, enroll, room_by_day)
  select
    c->>'id', c->>'code', c->>'name', (c->>'sec')::int, p_role_id, p_period,
    coalesce(c->>'teacher',''), coalesce(c->'blocks','[]'::jsonb), (c->>'enroll')::int, '{}'::jsonb
  from jsonb_array_elements(p_courses) c;
end; $$;

-- Alocação/desalocação: qualquer função ativa (institucional ou não) pode
-- alocar QUALQUER disciplina em QUALQUER sala — "Alocação Cruzada" é um
-- recurso intencional do sistema, não uma falha de isolamento (RoomSection
-- em classroom-allocation.jsx renderiza "Outras Funções" com os mesmos
-- canAllocate/canDealloc de "Salas Próprias"). Por isso, ao contrário de
-- create/edit/delete_course, aqui NÃO existe checagem de role_id === dono
-- da disciplina — só sessão válida + coordenação/período não travados.
create or replace function set_course_room_by_day(p_token text, p_course_id text, p_room_by_day jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_course courses;
begin
  select * into v_course from courses where id = p_course_id;
  if v_course.id is null then raise exception 'Disciplina não encontrada.'; end if;
  perform require_can_allocate(p_token, v_course.period);
  update courses set room_by_day = coalesce(p_room_by_day, '{}'::jsonb) where id = p_course_id;
end; $$;

-- Alocação automática (múltiplas disciplinas de uma vez) — mesma regra de
-- set_course_room_by_day, aplicada em lote dentro da mesma transação.
-- p_assignments: [{"course_id": "...", "room_by_day": {"seg":"r1",...}}, ...]
create or replace function apply_allocations(p_token text, p_assignments jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_item jsonb;
  v_course courses;
begin
  for v_item in select * from jsonb_array_elements(p_assignments) loop
    select * into v_course from courses where id = v_item->>'course_id';
    if v_course.id is null then continue; end if;
    perform require_can_allocate(p_token, v_course.period);
    update courses set room_by_day = coalesce(v_item->'room_by_day', '{}'::jsonb) where id = v_course.id;
  end loop;
end; $$;

-- Sempre opera sobre a PRÓPRIA função de quem chama (derivada da sessão) —
-- nunca recebe role_id/role_name/user_name do cliente, então não dá pra
-- "concluir" em nome de outra coordenação nem forjar o nome que aparece na
-- notificação da Diretoria.
create or replace function finish_coordination(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role_id text; v_role_name text; v_user_name text;
begin
  v_role_id := require_session(p_token);
  if is_institutional_role(v_role_id) then
    raise exception 'Funções institucionais não enviam conclusão de alocação.' using errcode = '42501';
  end if;

  select name into v_role_name from roles where id = v_role_id;
  select u.name into v_user_name from app_users u
    join app_sessions s on s.user_id = u.id where s.token = p_token;

  update coordination_statuses set status = 'finished' where role_id = v_role_id;
  insert into notifications (role_id, role_name, type, user_name)
  values (v_role_id, v_role_name, 'FINISHED', v_user_name);
end; $$;

-- Reabrir/bloquear a coordenação de QUALQUER função — só institucional com
-- MANAGE_COORDINATION_STATUS (é exatamente pra isso que essa permissão
-- existe: agir sobre o status de outras coordenações, não a própria).
create or replace function set_coordination_status(p_token text, p_role_id text, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_permission(p_token, 'MANAGE_COORDINATION_STATUS');
  update coordination_statuses set status = p_status where role_id = p_role_id;
end; $$;

-- Baixa importância / sem dado sensível — só exige estar logado.
create or replace function mark_all_notifications_read(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_session(p_token);
  update notifications set read = true where read = false;
end; $$;

revoke all on function create_course(text,text,text,text,int,text,text,text,jsonb,int) from public;
revoke all on function edit_course(text,text,text,int,text,text,jsonb,int,jsonb) from public;
revoke all on function delete_course(text,text) from public;
revoke all on function replace_role_courses(text,text,text,jsonb) from public;
revoke all on function set_course_room_by_day(text,text,jsonb) from public;
revoke all on function apply_allocations(text,jsonb) from public;
revoke all on function finish_coordination(text) from public;
revoke all on function set_coordination_status(text,text,text) from public;
revoke all on function mark_all_notifications_read(text) from public;

grant execute on function create_course(text,text,text,text,int,text,text,text,jsonb,int) to anon;
grant execute on function edit_course(text,text,text,int,text,text,jsonb,int,jsonb) to anon;
grant execute on function delete_course(text,text) to anon;
grant execute on function replace_role_courses(text,text,text,jsonb) to anon;
grant execute on function set_course_room_by_day(text,text,jsonb) to anon;
grant execute on function apply_allocations(text,jsonb) to anon;
grant execute on function finish_coordination(text) to anon;
grant execute on function set_coordination_status(text,text,text) to anon;
grant execute on function mark_all_notifications_read(text) to anon;

-- ─── Realtime ──────────────────────────────────────────────────────────────────
-- app_users/app_sessions intentionally NOT added here — the user list is
-- loaded on demand (list_app_users()), no live-sync need, and it avoids
-- broadcasting user metadata over a wider channel than necessary.
alter publication supabase_realtime add table
  sub_units, roles, blocks, rooms, courses, coordination_statuses, notifications, room_features, app_settings, periods;

insert into room_features (name) values ('Projetor'), ('Mesas de Desenho');