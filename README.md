# Sistema de Alocação de Salas — CCN/UFPI

Aplicação web para coordenar a alocação de salas de aula entre os
departamentos do Centro de Ciências da Natureza (CCN) da Universidade
Federal do Piauí. Cada chefe de departamento cadastra as disciplinas do
semestre e aloca suas turmas nas salas disponíveis; o Diretor tem visão e
controle sobre todos os departamentos, incluindo as salas compartilhadas
que não pertencem a nenhum departamento específico.

**Demo:**
- Produção: https://whitywolf.github.io/classroom-management/
- Dev: https://whitywolf.github.io/classroom-management/dev/

---

## Funcionalidades

- **Alocação de salas** — visão em Grade (quadro de horários semanal) ou
  em Salas (cartões de disponibilidade por sala, agrupados por bloco/prédio
  e por departamento), com detecção de conflito de horário em tempo real.
- **Disciplinas com múltiplos horários** — uma disciplina pode se reunir em
  dias diferentes com horários diferentes dentro da mesma turma (ex.:
  Segunda 15h–18h e Sexta 17h–18h), refletindo como ofertas reais de
  disciplina costumam ser estruturadas.
- **Importação de disciplinas** — o chefe de departamento sobe a planilha
  do semestre (`.csv`, `.ods` ou `.xlsx`) no formato do relatório de oferta
  de turmas do SIGAA (cabeçalho de disciplina + linhas de turma, código de
  horário como `35M34`, capacidade como `33/50 alunos`). O sistema decodifica
  o horário, ignora turmas com situação diferente de "Aberta", detecta
  duplicatas e mostra uma prévia (válidas / ignoradas / com erro) antes de
  confirmar a substituição completa das disciplinas do departamento.
- **Cadastro manual de disciplinas** — formulário para criar ou corrigir
  disciplinas pontualmente, com suporte a múltiplos blocos de horário.
- **Alocação automática** — algoritmo que distribui as disciplinas
  pendentes pelas salas disponíveis (prioriza salas do próprio
  departamento, ordena por matrícula e carga horária semanal), com tela de
  revisão antes de aplicar.
- **Mesclagem de turmas** — permite alocar duas disciplinas na mesma sala
  no mesmo horário quando a soma das matrículas ainda cabe na capacidade.
- **Salas compartilhadas** — salas reais que não pertencem a nenhum
  departamento (ex. Espaço Integrado, blocos do CCN2) só podem ser
  geridas/alocadas pelo Diretor.
- **Catálogo de recursos das salas** — lista de equipamentos (projetor,
  mesas de desenho etc.) gerenciável pelo Diretor, sem precisar editar código.
- **Fluxo de conclusão por departamento** — o chefe marca sua alocação como
  concluída (bloqueando edição própria); o Diretor pode reabrir ou forçar o
  bloqueio, e recebe notificação de cada conclusão.
- **Sincronização em tempo real** — duas pessoas em sessões diferentes veem
  as mudanças uma da outra quase instantaneamente, via Supabase Realtime.
- **Tema claro/escuro**, interface 100% em português.

---

## Stack

- **React 18 + Vite** — SPA sem roteador, build estático para GitHub Pages.
- **Supabase (Postgres)** — persistência compartilhada de salas, disciplinas,
  status de departamento e notificações, com Realtime habilitado.
- **SheetJS (`xlsx`)** — leitura de `.ods`/`.xlsx` no importador de
  disciplinas, carregado sob demanda (code-split) para não pesar o
  carregamento inicial de quem só usa `.csv`.
- Autenticação/RBAC ainda local (`localStorage`), não migrada para o
  Supabase Auth — ver "Limitações" abaixo.

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
├── auth/                       Camada de autenticação/RBAC (mock, local)
│   ├── roles.js                 Roles: CHIEF, DEPT_HEAD
│   ├── permissions.js           Permissões + mapa role→permissões
│   ├── utils.js                 Hash de senha, geração de token (não é
│   │                            criptografia de produção, ver TODOs)
│   ├── mockDb.js                "Banco" em localStorage + credenciais demo
│   └── AuthContext.jsx          AuthProvider / useAuth()
│
├── components/
│   ├── LoginPage.jsx             Tela de login
│   ├── UserManagement.jsx        Painel de gestão de usuários (Diretor)
│   └── PermissionGate.jsx        Wrapper declarativo de permissão
│
└── db/                          Camada de dados Supabase
    ├── supabaseClient.js         Cliente compartilhado + guarda de config
    ├── allocations.js            Uma função por mutação + fetchAll()
    └── useRealtimeSync.js        Único caminho que atualiza o estado local
                                   a partir de mudanças no Postgres

scripts/
├── import-real-rooms.mjs        Importa o inventário real de salas do CCN
│                                 a partir de scripts/data/salas-de-aula.csv
└── seed-test-courses.mjs        Disciplinas de teste para departamentos
                                  sem dados reais ainda

supabase/
└── schema.sql                   Schema completo (rodar uma vez no SQL
                                  Editor do Supabase em um projeto novo)
```

Não há convenção de um componente por arquivo: `classroom-allocation.jsx`
concentra toda a UI principal (~1500 linhas) deliberadamente — só os
componentes compartilhados com o subsistema de autenticação ficam em
`components/`.

---

## Papéis e permissões

O sistema tem dois papéis (não confundir com qualquer modelo mais elaborado
que apareça em rascunhos antigos — este é o modelo real, em
`src/auth/roles.js` e `src/auth/permissions.js`):

| Papel | Exibido como | Escopo |
|---|---|---|
| `CHIEF` | Diretor | Institucional — todos os departamentos, salas compartilhadas, gestão de usuários e do catálogo de recursos |
| `DEPT_HEAD` | Chefe de Departamento | Restrito ao próprio departamento — cadastra/aloca suas disciplinas, sem acesso a salas compartilhadas |

O Diretor nunca fica bloqueado pelo status "concluído" de um departamento;
o Chefe de Departamento perde a capacidade de editar quando seu
departamento está marcado como concluído ou bloqueado pelo Diretor.

---

## Modelo de dados (Supabase)

| Tabela | Conteúdo |
|---|---|
| `rooms` | Salas reais do CCN1/CCN2 — `dept_id` nulo significa sala compartilhada (só o Diretor gerencia) |
| `courses` | Disciplinas — `blocks` (jsonb) guarda uma lista de `{dias, início, fim}`, permitindo mais de um horário por disciplina; `teacher` guarda o(s) docente(s) da turma |
| `room_features` | Catálogo de recursos selecionáveis ao editar uma sala |
| `dept_statuses` | Status de cada departamento (`active` / `finished` / `force_finished`) |
| `notifications` | Notificações que o Diretor recebe quando um departamento conclui sua alocação |

Todas as tabelas têm Realtime habilitado e políticas de RLS permissivas
(`using (true)`) — ver "Limitações" sobre o que isso significa antes de
usar isto além de um protótipo.

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
2. Rode `supabase/schema.sql` no SQL Editor do projeto.
3. Copie a Project URL e a chave `anon`/`publishable` (Settings → API) para
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` no `.env.local`.
4. Copie a chave `service_role`/`secret` para `SUPABASE_SERVICE_ROLE_KEY`
   (usada só pelos scripts em `scripts/`, nunca pelo app no navegador).
5. Popule as salas reais: `node --env-file=.env.local scripts/import-real-rooms.mjs`.
6. As disciplinas são cadastradas pelo próprio Chefe de Departamento dentro
   do app (botão "Importar CSV" ou "+ Nova Disciplina"), não por script —
   esse é o fluxo de produção pretendido. `scripts/seed-test-courses.mjs`
   existe só para ter algo pra testar a alocação em departamentos sem
   dados reais ainda.

---

## Login de demonstração

| Usuário | Senha | Papel |
|---|---|---|
| `chief` | `chief123` | Diretor |
| `math.head` | `math123` | Chefe — Matemática |
| `phys.head` | `phys123` | Chefe — Física |
| `cs.head` | `cs123` | Chefe — Computação |
| `chem.head` | `chem123` | Chefe — Química |
| `bio.head` | `bio123` | Chefe — Biologia |

(Lista completa e atualizada em `DEMO_CREDENTIALS`, `src/auth/mockDb.js`.)

---

## Deploy

Dois workflows do GitHub Actions (`.github/workflows/`), ambos com
`keep_files: true` para não se atropelarem:

| Branch | Publica em | Variável de build |
|---|---|---|
| `main` | raiz do GitHub Pages | `VITE_BASE=/classroom-management/` |
| `dev` | `/dev/` | `VITE_BASE=/classroom-management/dev/` |

Os dois apontam para o **mesmo** projeto/dataset Supabase hoje — não há
ambientes dev/prod separados (limitação conhecida de protótipo).

---

## Limitações conhecidas (estágio de protótipo)

Cada um destes pontos está marcado com `// TODO (production):` no código
correspondente:

- **Autenticação ainda é local** (`localStorage`, hash não-criptográfico de
  produção) — não migrada para Supabase Auth. Não usar com usuários reais
  além de um ambiente controlado.
- **RLS permissiva** (`using (true)`) em todas as tabelas — qualquer
  cliente com a chave anônima lê/escreve tudo. Funciona porque o RBAC real
  ainda não existe no lado do banco; precisa de políticas por papel/depto
  antes de produção real.
- **Sem transação** em `replaceDeptCourses` (importação de disciplinas) —
  é um delete seguido de um insert em massa, não atômico.
- **Um único dataset Supabase** compartilhado entre os deploys de `main` e
  `dev`.

---

## Histórico e créditos

Projeto desenvolvido com assistência do Claude Code (Anthropic).
