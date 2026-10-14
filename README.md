# api.pagador.ao

API de recursos humanos e folha de pagamento do pagador.ao: NestJS 11, PostgreSQL com Row-Level Security, Redis/BullMQ, MinIO e Prisma, organizada por contextos delimitados (DDD).

A arquitectura está descrita em [`frontend/docs/09-arquitectura-tecnica.md`](../frontend/docs/09-arquitectura-tecnica.md); as regras de negócio estão nos documentos 02 a 05.

## Arranque rápido

Requisitos: Node 22+ (recomendado 24), pnpm, Docker e OpenSSL.

```bash
pnpm install
cp .env.example .env          # ajuste GMAIL_USER / GMAIL_APP_PASSWORD para enviar e-mails
pnpm keys:generate            # par de chaves RS256 em ./keys
docker compose up -d postgres redis minio
pnpm db:migrate               # migrações, incluindo as políticas de RLS
pnpm db:seed                  # bancos, províncias, tabelas legais e empresa de demonstração
pnpm start:dev                # API em http://localhost:3333/v1
pnpm start:worker             # noutro terminal: outbox, notificações, cálculo e alertas
```

**Documentação interactiva (Swagger):** <http://localhost:3333/v1/docs> · especificação: `/v1/openapi.json`.

### Tudo em contentores

```bash
pnpm keys:generate
docker compose up -d --build
```

| Serviço | Função | Porta |
| --- | --- | --- |
| `postgres` | PostgreSQL 16 | 5432 |
| `redis` | Filas BullMQ e adaptador Socket.IO | 6379 |
| `minio` | Ficheiros (S3); consola em `:9001` | 9000, 9001 |
| `migrate` | Tarefa única: `prisma migrate deploy` e seed | — |
| `api` | HTTP e Socket.IO (`/realtime`) | 3333 |
| `worker` | Processadores BullMQ | — |

A `api` e o `worker` lêem o `.env` e substituem apenas os nomes de anfitrião da rede do compose.

## Contas de demonstração

O seed cria a empresa **Kianda Logística, Lda.** com 13 trabalhadores (os mesmos dos dados de demonstração do frontend). Palavra-passe de todas as contas: `Pagador#2026` (altere com `SEED_DEMO_PASSWORD`; `SEED_DEMO=false` cria só os dados de referência).

| E-mail | Papéis | Útil para |
| --- | --- | --- |
| `admin@kianda.co.ao` | Administrador, RH, processador, aprovador | Tudo |
| `isabel.neto@kianda.co.ao` | Gestora de RH, chefia | Trabalhadores, férias, contratos |
| `ana.mateus@kianda.co.ao` | Processadora salarial | Calcular e submeter a folha |
| `graca.mbemba@kianda.co.ao` | Aprovadora financeira | Aprovar a folha e os lotes bancários |
| `edvania.tavares@kianda.co.ao` | Técnica de RH | Perfil sem acesso à folha |
| `domingos.cassoma@kianda.co.ao` | Chefia | Aprovar pedidos da equipa |

A segregação de funções aplica-se: quem calcula uma folha não a pode aprovar.

## Configuração

Todas as variáveis estão em [`.env.example`](./.env.example) e são validadas com Zod no arranque.

- **Autenticação — RS256.** `JWT_PRIVATE_KEY_PATH` assina os tokens de acesso (15 min); `JWT_PUBLIC_KEY_PATH` valida-os. Os tokens viajam em cookies `HttpOnly` (`access_token`; `refresh_token` só em `/v1/auth`) ou em `Authorization: Bearer`. As mutações exigem um cabeçalho `Origin` incluído em `CORS_ORIGINS`.
- **Ficheiros — MinIO.** `S3_*` aponta para o MinIO local; o bucket é criado automaticamente. Em produção, qualquer serviço compatível com S3.
- **E-mail — Nodemailer com Gmail.** Use uma *palavra-passe de aplicação* Google (Conta Google → Segurança → Verificação em dois passos → Palavras-passe de aplicações) em `GMAIL_APP_PASSWORD`. Sem credenciais, os e-mails são escritos no log.

## Comandos

| Comando | Descrição |
| --- | --- |
| `pnpm start:dev` | Serviços de suporte e API em modo *watch* |
| `pnpm start:worker` | Worker em modo *watch* |
| `pnpm build` | Compila para `dist/` (`main.js`, `worker.js`, `seed.js`) |
| `pnpm start:prod` / `pnpm start:worker:prod` | Executa a compilação |
| `pnpm db:migrate:dev` | Cria uma migração a partir do `schema.prisma` |
| `pnpm db:migrate` | Aplica as migrações pendentes |
| `pnpm db:seed` | Seed idempotente |
| `pnpm keys:generate` | Novo par de chaves RS256 |
| `pnpm lint` / `pnpm format` | ESLint e Prettier |

## Organização

```
src/
├── main.ts · worker.ts · seed.ts
├── contexts/<contexto>/
│   ├── domain/           # agregados, objectos de valor, regras puras (sem NestJS nem Prisma)
│   ├── application/      # casos de uso (uma classe com execute) e serviços de consulta
│   ├── infrastructure/   # repositórios, adaptadores, PDF, formatos bancários
│   ├── presentation/     # controllers REST com DTO Zod e anotações Swagger
│   └── public/           # fachada usada pelos outros contextos
├── worker/               # processadores BullMQ e projector de notificações
└── shared/               # domínio, aplicação, infra-estrutura e apresentação transversais
```

Cada pedido corre numa transacção com `app.tenant_id` definido e o papel `pagador_app`, por isso o PostgreSQL filtra todas as consultas pelo tenant, mesmo que um repositório se esqueça do filtro. As alterações escrevem na mesma transacção o registo de auditoria (encadeado por hash; verificável em `GET /v1/audit-logs/verify`) e os eventos da outbox.

Os erros seguem o formato *Problem Details* (RFC 9457), com um `code` estável que o frontend traduz.
