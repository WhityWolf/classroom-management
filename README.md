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
  alocadas ou apenas vazias), "Mapa do Campus" (ver abaixo) e, só pra quem
  tem permissão de gerenciamento (Diretor/secretários), uma opção
  "Gerenciamento".
- **Mapa do Campus** — mostra onde cada *bloco* (não sala individual) fica
  fisicamente, como pinos sobre uma imagem estática do campus (gerada a
  partir de um export do OpenStreetMap — `src/assets/campus-map.png`, sem
  nenhuma chamada a serviço de mapa externo em tempo de execução, então
  funciona em rede totalmente interna/offline). Clicar num pino mostra o
  nome do bloco e a lista de salas dele. A posição de cada bloco é salva
  como porcentagem da imagem (`blocks.map_x`/`map_y`, não pixel — continua
  válida em qualquer tamanho de tela ou se a imagem for trocada depois), via
  a função `set_block_position`. Editar posições (arrastar um pino
  existente, ou clicar num bloco "sem posição" e depois no mapa pra
  posicioná-lo) é restrito a quem tem `MANAGE_BLOCKS` — mesma permissão que
  já controla o CRUD de blocos em Gerenciamento; qualquer usuário logado
  pode *ver* o mapa. Atribuição "© OpenStreetMap contributors" incluída na
  própria imagem (exigência da licença ODbL dos dados).
- **Trocar a própria senha** — botão "Trocar Senha" nessa mesma tela de
  seleção, ao lado de "Sair", disponível pra qualquer usuário logado
  (inclusive chefes/coordenadores, que não têm `EDIT_ANY_USER` e por isso
  não conseguiam mudar a própria senha antes desta função existir). Pede a
  senha atual antes de aceitar a nova.
- **Gerenciamento institucional** — tela dedicada (não é exclusiva por
  identidade de usuário, e sim por permissão) com abas, nesta ordem:
  **Sub-Unidades** (criar/editar/excluir); **Usuários e Funções** (uma aba
  só, com um sub-toggle interno — criar/editar usuários e atribuir sua
  função, e criar/editar/excluir funções definindo quais permissões e quais
  salas cada uma tem); **Salas e Blocos** (criar/editar/excluir, incluindo
  dar ou tirar a sala de uma função); e **Períodos** (criar um novo período
  letivo — que já existe por conta própria, mesmo sem nenhuma disciplina
  cadastrada nele — ou excluir um período existente, mediante confirmação
  que mostra quantas disciplinas serão apagadas junto; essa é a única forma
  de remover um período do sistema).
- **Múltiplos períodos letivos** — um seletor de período (ex. `2026.1`)
  aparece nas telas de alocação e de mapa. O período é uma entidade
  persistida por conta própria (tabela `periods`) — existe mesmo sem
  nenhuma disciplina cadastrada nele, inclusive aparecendo (vazio) no Mapa
  de Salas. Só o período mais recente pode ser editado; períodos passados
  ficam travados (inclusive pra função institucional) e, na tela de
  Alocação, a vista em Salas é desabilitada nesse caso — só dá pra consultar
  pela Grade, já que não há nada a alocar num período encerrado. Quem tem
  permissão institucional cria um novo período letivo a qualquer momento
  (o que automaticamente torna o anterior somente leitura) e pode excluir
  qualquer período pela aba Períodos de Gerenciamento — mediante
  confirmação, já que isso apaga junto todas as disciplinas cadastradas
  nele; essa é a única forma de remover um período do sistema.
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
  (`.ods`, `.xlsx` ou `.csv`) no formato do relatório de oferta de turmas do
  SIGAA: uma linha de cabeçalho por disciplina (`"CÓDIGO - NOME (NÍVEL)"`)
  seguida de uma linha por turma, com as colunas Ano Período, Turma,
  Docente(s), Tipo, Situação, Horário, Local e Mat./Cap. — só Turma,
  Docente(s), Horário e Mat./Cap. viram dado de verdade (Ano Período, Tipo,
  Situação e Local do arquivo são ignorados; o período é o já selecionado na
  tela, e turmas ainda com "A DEFINIR DOCENTE" entram normalmente, sem
  filtro por situação). Horário usa o código do SIGAA, ex. `35M34`, podendo
  ter mais de um bloco para dias diferentes. O sistema decodifica o horário,
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
  funções, blocos, salas, disciplinas, períodos letivos, status de
  coordenação, notificações e usuários, com Realtime habilitado nas tabelas
  de domínio.
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
│   ├── ManagementScreen.jsx       Sub-Unidades, Usuários e Funções, Salas
│   │                              e Blocos, Períodos — terceira opção
│   │                              pós-login
│   └── PermissionGate.jsx         Wrapper declarativo de permissão (não usado
│                                   atualmente — todo o gating real é inline)
│
└── db/                          Camada de dados Supabase
    ├── supabaseClient.js         Cliente compartilhado + guarda de config
    ├── allocations.js            Sub-unidades/funções/blocos/salas/disciplinas/
    │                              períodos/status de coordenação — uma
    │                              função por mutação + fetchAll()
    ├── management.js             CRUD de sub_units/roles/blocks/rooms/periods
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
| `blocks` | Blocos/prédios físicos (ex. `CCN1`/`SG-04`) — `map_x`/`map_y` (percentual 0-100, `null` = sem posição) é o pino no Mapa do Campus |
| `rooms` | Salas reais do CCN1/CCN2 — `role_id` nulo significa sala compartilhada (só quem tem `MANAGE_ROOMS` gerencia); `block_id` aponta pro bloco físico |
| `courses` | Disciplinas — `role_id` é a coordenação dona; `blocks` (jsonb) guarda uma lista de `{dias, início, fim}` de horário (não confundir com a tabela `blocks` acima); `room_by_day` (jsonb) mapeia cada dia pra sala alocada nele; `period` (ex. `"2026.1"`) marca o período letivo — só o mais recente é editável |
| `periods` | Períodos letivos (ex. `"2026.1"`) — existem por conta própria, independente de ter alguma disciplina cadastrada; `courses.period` não é uma FK pra cá (soft reference), pra não travar em dados legados |
| `coordination_statuses` | Status de cada coordenação (`active` / `finished` / `force_finished`) |
| `notifications` | Notificações recebidas quando uma coordenação conclui sua alocação |
| `room_features` | Catálogo de recursos selecionáveis ao editar uma sala |
| `app_users` | Usuários — senha em `password_hash` (bcrypt via `pgcrypto`), nunca lida/escrita direto pelo cliente |
| `app_sessions` | Sessões de login (token + validade) |

Tabelas de domínio (tudo exceto `app_users`/`app_sessions`) têm Realtime
habilitado. RLS nelas libera **leitura** (`select using (true)`) pra
`anon`, mas **INSERT/UPDATE/DELETE são revogados** — toda escrita passa por
uma função `security definer` que valida o token de sessão (o mesmo devolvido
por `authenticate_app_user` no login) e a permissão certa antes de gravar
(`create_sub_unit`/`update_role`/`delete_room_and_unallocate`/
`set_course_room_by_day`/etc. — ver `supabase/schema.sql`). `app_users`/
`app_sessions` continuam sem nenhuma policy — só acessíveis através das
funções de autenticação (`create_app_user`, `authenticate_app_user`,
`validate_app_session`, `update_app_user`, `deactivate_app_user`,
`list_app_users`, `delete_app_user`, `revoke_app_session`,
`change_own_password`), nunca lidas/
escritas direto. `bootstrap_admin_user` é a exceção: cria o primeiro usuário
de um projeto novo e só pode ser chamada com acesso direto ao Postgres (SQL
Editor), nunca pelo app.

---

## Segurança das mutações (RPC autenticado)

Como não há Supabase Auth nem backend próprio (ver "Limitações" abaixo), o
Postgres não tem como saber sozinho quem está fazendo uma requisição — só a
chave anônima chega até ele, igual pra todo mundo. Por isso, toda mutação de
domínio (sub-unidades, funções, blocos, salas, disciplinas, períodos,
coordenação, usuários) é uma função `security definer` que recebe o token de
sessão como primeiro parâmetro e valida ele mesma, via um punhado de helpers
(`require_session`/`require_permission`/`require_can_allocate`/etc., topo de
`supabase/schema.sql`) antes de escrever:

- **Sessão**: token precisa existir em `app_sessions`, não estar expirado, e
  o usuário dono dele precisa estar ativo — senão a função recusa com uma
  mensagem de sessão inválida.
- **Permissão**: a função checa exatamente a mesma flag de `PERMS` que a UI
  já usava só como enfeite visual (esconder o botão) — agora ela também é
  aplicada no servidor.
- **Posse**: criar/editar/excluir uma disciplina exige que a função de quem
  chama seja a dona dela (ou institucional) — mas **alocar/desalocar sala**
  não tem essa checagem de propósito, porque "Alocação Cruzada" (qualquer
  coordenação ativa aloca em salas de qualquer outra) é um recurso
  intencional do sistema, não uma falha de isolamento.
- **Trava de período/coordenação**: mexer numa disciplina exige que o
  período dela seja o mais recente (institucional ignora essa trava) e que a
  própria coordenação de quem chama não esteja com status `finished`.

O cliente lê o token direto do `localStorage` (`src/db/sessionToken.js`) e
anexa ele em cada chamada — nenhum componente React precisa saber disso,
só a camada `src/db/*.js`. As mutações de sala/função/período que apagam
dados em cascata (`delete_room_and_unallocate`, `delete_role_and_courses`,
`delete_period_and_courses`) continuam atômicas (ver comentário de cada uma
em `supabase/schema.sql`): se qualquer passo falhar no meio, tudo desfaz.

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
   `select bootstrap_admin_user('usuario', 'Nome', 'email@...', 'senha', 'ID_DA_FUNCAO');`
   — função separada de `create_app_user` porque esta última agora exige uma
   sessão autenticada com `CREATE_ANY_USER` (ver Segurança abaixo), e o
   primeiro usuário do projeto ainda não tem nenhuma sessão pra apresentar;
   `bootstrap_admin_user` só roda uma vez (recusa se já existir algum
   usuário) e não é liberada pro app via RPC, só pra quem tem acesso direto
   ao SQL Editor. Depois disso, crie as sub-unidades e funções de
   coordenação de exemplo (ou reais) — pelo próprio app já logado, ou ainda
   via SQL Editor se preferir.
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

- **Token de sessão em `localStorage`**, não um cookie `httpOnly` — não há
  backend próprio ainda para emitir esse cookie. Isso é ortogonal à
  autorização (ver "Segurança das mutações" acima): mesmo com todo mutation
  passando por checagem de permissão no servidor, o token em si ainda fica
  num lugar acessível a qualquer JavaScript rodando na página (um XSS
  roubaria o token deste usuário, por exemplo) — um cookie `httpOnly`
  exigiria um backend próprio no meio pra emiti-lo, o que é uma mudança de
  arquitetura maior (deixar de ser uma SPA estática falando direto com o
  Supabase), não um ajuste pontual.
- **Um único dataset Supabase** compartilhado entre os deploys de `main` e
  `dev`.
- **Permissão de sala é só por função**, sem override individual por
  usuário — uma decisão de design (não uma limitação a corrigir): dois
  usuários com a mesma função sempre têm exatamente as mesmas salas.

---

## Histórico e créditos

Projeto desenvolvido com assistência do Claude Code (Anthropic).