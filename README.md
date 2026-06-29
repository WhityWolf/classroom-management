# Sistema de Alocação de Salas — CCN/UFPI

Aplicação web para coordenar a alocação de salas de aula entre as
sub-unidades do Centro de Ciências da Natureza (CCN) da Universidade Federal
do Piauí. Cada sub-unidade (ex. Matemática) pode ter mais de uma
**coordenação** com salas próprias (ex. Coordenador de Graduação,
Coordenador de Pós-Graduação, Coordenador PROFMAT) — cada coordenação
cadastra suas disciplinas e aloca suas turmas só nas salas que pertencem a
ela. O Diretor (e seus secretários, usuários com a mesma função
institucional) têm visão e controle sobre todas as sub-unidades/coordenações,
incluindo as salas compartilhadas que não pertencem a nenhuma coordenação
específica, e são os únicos que podem criar usuários, sub-unidades, funções,
salas e blocos novos.

**Demo:**
- Produção: https://whitywolf.github.io/classroom-management/
- Dev: https://whitywolf.github.io/classroom-management/dev/

---

## Funcionalidades

- **Seleção de tela pós-login** — antes de entrar na alocação, o usuário
  escolhe entre "Alocar Disciplinas" (o fluxo de sempre), "Mapa de Salas"
  (visão somente-leitura de todas as salas, organizadas por departamento →
  bloco; cada sala tem sua própria tabela com dias da semana como colunas e
  horários 8h–22h como linhas; um seletor filtra entre todas as salas, apenas
  alocadas ou apenas vazias) e, só pra quem tem permissão de gerenciamento
  (Diretor/secretários), uma terceira opção "Gerenciamento".
- **Gerenciamento institucional** — tela dedicada (não é exclusiva por
  identidade de usuário, e sim por permissão) com abas para: criar/editar
  usuários e atribuir sua função; criar/editar/excluir funções (definindo
  quais permissões e quais salas cada uma tem); criar/editar/excluir
  sub-unidades novas (ex. uma sub-unidade de Arqueologia); e criar/editar/
  excluir salas e blocos, incluindo dar ou tirar a sala de uma função.
- **Múltiplos períodos letivos** — um seletor de período (ex. `2026.1`)
  aparece nas telas de alocação e de mapa. Só o período mais recente pode
  ser editado; períodos passados ficam travados (inclusive pra função
  institucional) e, na tela de Alocação, a vista em Salas é desabilitada
  nesse caso — só dá pra consultar pela Grade, já que não há nada a alocar
  num período encerrado. Quem tem permissão institucional cria um novo
  período letivo a qualquer momento, o que automaticamente torna o anterior
  somente leitura.
- **Alocação de salas** — visão em Grade (quadro de horários semanal) ou
  em Salas (cartões de disponibilidade por sala, agrupados por bloco/prédio
  e por função), com detecção de conflito de horário em tempo real.
- **Disciplinas com múltiplos horários** — uma disciplina pode se reunir em
  dias diferentes com horários diferentes dentro da mesma turma (ex.:
  Segunda 15h–18h e Sexta 17h–18h), refletindo como ofertas reais de
  disciplina costumam ser estruturadas.
- **Sala diferente em dia diferente** — a vista em Grade aloca dia a dia: dá
  pra colocar a mesma disciplina numa sala na Segunda e numa sala diferente
  na Quarta. A vista em Salas continua alocando todos os dias de uma vez na
  mesma sala, pra quem só precisa do caso comum.
- **Importação de disciplinas** — quem tem permissão de catálogo (a própria
  coordenação, ou a função institucional agindo por ela) sobe uma planilha
  (`.ods`, `.xlsx` ou `.csv`) com uma linha por disciplina/turma (colunas
  Código, Nome, Turma, Docente(s), Horário, Alunos Mat. — Turma é opcional e
  nunca numerada automaticamente: fica em branco a menos que o usuário a
  preencha, necessário só quando o mesmo código tem mais de uma turma no
  arquivo; Horário usa o código do SIGAA, ex. `35M34`, podendo ter mais de um
  bloco para dias diferentes). Um botão na própria tela de import baixa um
  modelo `.ods` já preenchido com exemplos. O sistema decodifica o horário,
  detecta duplicatas e mostra uma prévia (válidas / com erro) antes de
  confirmar a substituição completa das disciplinas daquela coordenação.
- **Cadastro manual de disciplinas** — formulário para criar ou corrigir
  disciplinas pontualmente, com suporte a múltiplos blocos de horário.
- **Alocação automática** — algoritmo que distribui as disciplinas
  pendentes pelas salas disponíveis (prioriza salas da própria função,
  ordena por matrícula e carga horária semanal), com tela de revisão antes
  de aplicar.
- **Mesclagem de turmas** — permite alocar duas disciplinas na mesma sala
  no mesmo horário quando a soma das matrículas ainda cabe na capacidade.
- **Salas compartilhadas** — salas reais que não pertencem a nenhuma função
  (ex. Espaço Integrado, blocos do CCN2) só podem ser geridas/alocadas por
  quem tem permissão institucional.
- **Catálogo de recursos das salas** — lista de equipamentos (projetor,
  mesas de desenho etc.) gerenciável por quem tem permissão de gerenciar
  salas, sem precisar editar código.
- **Fluxo de conclusão por coordenação** — a coordenação marca sua alocação
  como concluída (bloqueando edição própria); quem tem permissão
  institucional pode reabrir ou forçar o bloqueio, e recebe notificação de
  cada conclusão.
- **Sincronização em tempo real** — duas pessoas em sessões diferentes veem
  as mudanças uma da outra quase instantaneamente, via Supabase Realtime.
- **Tema claro/escuro**, interface 100% em português.

---

## Stack

- **React 18 + Vite** — SPA sem roteador, build estático para GitHub Pages.
- **Supabase (Postgres)** — persistência compartilhada de sub-unidades,
  funções, blocos, salas, disciplinas, status de coordenação, notificações
  e usuários, com Realtime habilitado nas tabelas de domínio.
- **SheetJS (`xlsx`)** — leitura de `.ods`/`.xlsx` no importador de
  disciplinas, carregado sob demanda (code-split) para não pesar o
  carregamento inicial de quem só usa `.csv`.
- **Autenticação em Postgres puro** — usuários e senhas (hash bcrypt via
  `pgcrypto`) vivem na tabela `app_users`, acessada só através de funções SQL
  `security definer` (nunca lida/escrita direto pelo cliente). Deliberadamente
  **não** usa Supabase Auth nem Edge Functions: o sistema é pra eventualmente
  rodar nos servidores da própria universidade, sem depender de nenhum
  serviço proprietário de terceiros (ver `CLAUDE.md`, seção "Deployment
  target") — então a troca de `supabase-js` por chamadas a uma API própria,
  quando essa migração acontecer, fica restrita a `src/db/*`.

---

## Arquitetura

```
src/
├── main.jsx                    Ponto de entrada, monta <App/>
├── classroom-allocation.jsx    App inteiro: constantes, algoritmo de
│                                alocação automática e todos os componentes
│                                de UI (Dashboard, Grid, ListView, modais)
├── theme.jsx                   Tokens de tema (claro/escuro) + helpers
│
├── auth/                        Camada de autenticação
│   ├── roles.js                  isInstitutionalRole(role) — uma função é
│   │                              institucional quando não pertence a
│   │                              nenhuma sub-unidade (subUnitId null)
│   ├── permissions.js             Identificadores de permissão (PERMS) —
│   │                              o conjunto que cada função tem vem do
│   │                              banco (role.permissions), não daqui
│   ├── utils.js                   Formatação de data (formatDate/formatDateTime)
│   └── AuthContext.jsx            AuthProvider / useAuth() — can(perm) /
│                                   canForRole(perm, roleId)
│
├── components/
│   ├── LoginPage.jsx              Tela de login
│   ├── UserManagement.jsx         Lista/edita/desativa usuários (sem criar
│   │                              — criação é só pela tela de Gerenciamento)
│   ├── ManagementScreen.jsx       Usuários, Funções, Sub-unidades, Salas e
│   │                              Blocos — terceira opção pós-login
│   └── PermissionGate.jsx         Wrapper declarativo de permissão (não usado
│                                   atualmente — todo o gating real é inline)
│
└── db/                          Camada de dados Supabase
    ├── supabaseClient.js         Cliente compartilhado + guarda de config
    ├── allocations.js            Sub-unidades/funções/blocos/salas/disciplinas/
    │                              status de coordenação — uma função por
    │                              mutação + fetchAll()
    ├── management.js             CRUD de sub_units/roles/blocks/rooms
    ├── authApi.js                Usuários/sessão — chama as funções SQL
    │                              security definer via supabase.rpc()
    └── useRealtimeSync.js        Único caminho que atualiza o estado local
                                   a partir de mudanças no Postgres

scripts/
├── import-real-rooms.mjs        Importa o inventário real de blocos/salas do
│                                 CCN a partir de scripts/data/salas-de-aula.csv
│                                 (depende das sub-unidades/funções já existirem)
├── seed-test-courses.mjs        Disciplinas de teste para coordenações sem
│                                 dados reais ainda
├── seed-past-period-test.mjs    Disciplinas fictícias num período passado,
│                                 só para exercitar a UI somente-leitura
└── legacy/seed-supabase.mjs     Histórico — não roda no schema atual

supabase/
└── schema.sql                   Schema completo (rodar uma vez no SQL
                                  Editor do Supabase em um projeto novo) —
                                  inclui as tabelas de domínio e as funções
                                  de autenticação em Postgres puro
```

Não há convenção de um componente por arquivo: `classroom-allocation.jsx`
concentra toda a UI principal de alocação (~2100 linhas) deliberadamente —
só os componentes de outras telas (login, gestão de usuários, gerenciamento)
ficam em `components/`.

---

## Sub-unidades, funções e permissões

O modelo não é mais um enum fixo de dois papéis — **funções são dados**,
guardados na tabela `roles` e geridos pela tela de Gerenciamento, não no
código-fonte:

- **Sub-unidade** (`sub_units`) — a unidade organizacional "de cima" (ex.
  Matemática, Física). Existe só para agrupar visualmente funções
  relacionadas (mesma cor de UI) — quem realmente possui salas e disciplinas
  é a função, não a sub-unidade.
- **Função** (`roles`) — pode ser institucional (`sub_unit_id` nulo — ex.
  Diretor, Secretário do Diretor: vê e gerencia tudo, dentro das permissões
  que tiver) ou pertencer a uma sub-unidade (ex. "Coordenador de
  Graduação" em Matemática). Cada função carrega sua própria lista de
  permissões (`permissions text[]`, um subconjunto de `PERMS`).
  Múltiplos usuários podem compartilhar a mesma função (ex. um coordenador e
  seus secretários) — todos têm exatamente as mesmas permissões e salas
  automaticamente, porque a permissão "mora" na função, não no usuário.
- **Sala** (`rooms.role_id`) — pertence a uma função específica (não à
  sub-unidade inteira). Por isso uma sub-unidade pode ter várias
  coordenações com salas completamente separadas — o exemplo real é
  Matemática: Coordenador de Graduação (sala SG-04), Coordenador de
  Pós-Graduação (salas PPG-Matemática) e Coordenador PROFMAT (salas
  PROFMAT), cada um só aloca nas suas próprias salas. `role_id` nulo = sala
  compartilhada, sem função dona — só quem tem a permissão `MANAGE_ROOMS`
  (tipicamente institucional) aloca/edita.
- **Bloco** (`blocks`) — o prédio/bloco físico de uma sala (ex. `CCN1 —
  SG-04`), só para agrupamento visual; não tem relação com `courses.blocks`
  (que são os blocos de *horário* de uma disciplina — nomes iguais,
  conceitos diferentes).

Criação de usuário é modular e só acontece pela tela de Gerenciamento, por
quem tem a permissão `CREATE_ANY_USER` (Diretor e seus secretários, por
padrão) — nunca pela tela de Usuários (que só lista/edita/desativa) e nunca
restrita por identidade de papel único, e sim por permissão: criar uma nova
sub-unidade e uma função institucional nova com essa mesma permissão dá a
qualquer usuário daquela função o mesmo poder de criar outros usuários.

Uma função institucional nunca fica bloqueada pelo status "concluído" de
uma coordenação; uma função de coordenação perde a capacidade de editar
quando sua coordenação está marcada como concluída ou bloqueada por quem
tem permissão institucional.

---

## Modelo de dados (Supabase)

| Tabela | Conteúdo |
|---|---|
| `sub_units` | Sub-unidades (ex. Matemática) — nome e cores de UI |
| `roles` | Funções — `sub_unit_id` nulo = institucional; `permissions` (text[]) é o subconjunto de `PERMS` que essa função tem; `is_system` protege a função raiz do Diretor contra exclusão |
| `blocks` | Blocos/prédios físicos (ex. `CCN1`/`SG-04`) |
| `rooms` | Salas reais do CCN1/CCN2 — `role_id` nulo significa sala compartilhada (só quem tem `MANAGE_ROOMS` gerencia); `block_id` aponta pro bloco físico |
| `courses` | Disciplinas — `role_id` é a coordenação dona; `blocks` (jsonb) guarda uma lista de `{dias, início, fim}` de horário (não confundir com a tabela `blocks` acima); `room_by_day` (jsonb) mapeia cada dia pra sala alocada nele; `period` (ex. `"2026.1"`) marca o período letivo — só o mais recente é editável |
| `coordination_statuses` | Status de cada coordenação (`active` / `finished` / `force_finished`) |
| `notifications` | Notificações recebidas quando uma coordenação conclui sua alocação |
| `room_features` | Catálogo de recursos selecionáveis ao editar uma sala |
| `app_users` | Usuários — senha em `password_hash` (bcrypt via `pgcrypto`), nunca lida/escrita direto pelo cliente |
| `app_sessions` | Sessões de login (token + validade) |

Tabelas de domínio (tudo exceto `app_users`/`app_sessions`) têm Realtime
habilitado e políticas de RLS permissivas (`using (true)`) — ver
"Limitações" sobre o que isso significa antes de usar isto além de um
protótipo. `app_users`/`app_sessions` têm RLS habilitado **sem** nenhuma
policy — só são acessíveis através das funções `security definer`
(`create_app_user`, `authenticate_app_user`, `validate_app_session`,
`update_app_user`, `deactivate_app_user`, `list_app_users`,
`revoke_app_session`), nunca lidas/escritas direto.

---

## Como rodar localmente

```bash
npm install
cp .env.example .env.local   # preencher com as chaves do seu projeto Supabase
npm run dev
```

Sem `.env.local`, o app carrega e o login funciona, mas mostra "Supabase
não configurado" após entrar — ver `src/db/supabaseClient.js`.

### Configurando um projeto Supabase do zero

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Rode `supabase/schema.sql` inteiro no SQL Editor do projeto.
3. Copie a Project URL e a chave `anon`/`publishable` (Settings → API) para
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` no `.env.local`.
4. Copie a chave `service_role`/`secret` para `SUPABASE_SERVICE_ROLE_KEY`
   (usada só pelos scripts em `scripts/`, nunca pelo app no navegador).
5. **Seed manual via SQL Editor** (não tem script pra isso de propósito —
   é uma decisão institucional, não um dado a gerar): insira a função
   institucional raiz (`is_system = true`) e o primeiro usuário via
   `select create_app_user('usuario', 'Nome', 'email@...', 'senha', 'ID_DA_FUNCAO', null);`,
   depois as sub-unidades e funções de coordenação de exemplo (ou reais).
6. Popule blocos/salas reais: `node --env-file=.env.local scripts/import-real-rooms.mjs`
   (depende das funções de coordenação do passo 5 já existirem).
7. As disciplinas são cadastradas pela própria coordenação dentro do app
   (botão "Importar ODS" ou "+ Nova Disciplina"), não por script — esse é o
   fluxo de produção pretendido. `scripts/seed-test-courses.mjs` existe só
   para ter algo pra testar a alocação em coordenações sem dados reais ainda.
8. Daí em diante, novos usuários/funções/sub-unidades/salas/blocos são
   criados de dentro do próprio app, pela tela de Gerenciamento — não
   precisa mais voltar ao SQL Editor pra isso.

---

## Login de demonstração

| Usuário | Senha | Função |
|---|---|---|
| `admin` | `chief123` | Diretor |
| `math.grad` | `math123` | Coordenador de Graduação — Matemática |
| `math.pos` | `math123` | Coordenador de Pós-Graduação — Matemática |
| `math.profmat` | `math123` | Coordenador PROFMAT — Matemática |
| `phys.head` | `phys123` | Chefe de Departamento — Física |
| `cs.head` | `cs1234` | Chefe de Departamento — Computação |
| `chem.head` | `chem123` | Chefe de Departamento — Química |
| `bio.head` | `bio123` | Chefe de Departamento — Biologia |

(Lista de exibição em `DEMO_CREDENTIALS`, `src/components/LoginPage.jsx` —
reflete o seed de exemplo acima, não é lida de nenhum "banco" mock; se o
seed do seu projeto for diferente, ajuste essa lista ou ignore o painel.)

---

## Deploy

Dois workflows do GitHub Actions (`.github/workflows/`), ambos com
`keep_files: true` para não se atropelarem:

| Branch | Publica em | Variável de build |
|---|---|---|
| `main` | raiz do GitHub Pages | `VITE_BASE=/classroom-management/` |
| `dev` | `/dev/` | `VITE_BASE=/classroom-management/dev/` |

Os dois apontam para o **mesmo** projeto/dataset Supabase hoje — não há
ambientes dev/prod separados (limitação conhecida de protótipo). O destino
final pretendido não é o GitHub Pages + Supabase administrado, e sim os
servidores da própria universidade, sem depender de serviço proprietário de
terceiros — ver `CLAUDE.md`.

---

## Limitações conhecidas (estágio de protótipo)

- **RLS permissiva** (`using (true)`) nas tabelas de domínio — qualquer
  cliente com a chave anônima lê/escreve tudo nelas (a única tabela
  realmente trancada é `app_users`/`app_sessions`, só acessível via função).
  Precisa de políticas reais por função/permissão antes de produção.
- **Token de sessão em `localStorage`**, não um cookie `httpOnly` — não há
  backend próprio ainda para emitir esse cookie.
- **Sem transação** em `replaceRoleCourses` (importação de disciplinas) —
  é um delete seguido de um insert em massa, não atômico.
- **Um único dataset Supabase** compartilhado entre os deploys de `main` e
  `dev`.
- **Permissão de sala é só por função**, sem override individual por
  usuário — uma decisão de design (não uma limitação a corrigir): dois
  usuários com a mesma função sempre têm exatamente as mesmas salas.

---

## Histórico e créditos

Projeto desenvolvido com assistência do Claude Code (Anthropic).
