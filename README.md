# Flowboard

A small project-management app: a space, folder, and list hierarchy, kanban and list views, scoped statuses, and custom fields.

Build plan and design decisions: [`docs/PLAN.md`](docs/PLAN.md). AI usage log: [`AI_USAGE.md`](AI_USAGE.md).

## 1. Run

Prerequisite: Docker with Compose v2.

```bash
docker compose up --build      # or: make up
```

On first boot the api applies the migrations and seeds the demo data. Both steps are idempotent, so a restart keeps your data. Run `make reset` to delete the database volume and start again from the seed.

| Service | URL                   | Notes                                     |
| ------- | --------------------- | ----------------------------------------- |
| web     | http://localhost:8080 | React app; nginx proxies `/v1` → api      |
| api     | http://localhost:3000 | Fastify, REST under `/v1`                 |
| db      | localhost:5432        | Postgres 18, user/password/db `flowboard` |

Copy `.env.example` to `.env` to change ports or credentials. The stack also starts without a `.env` file.

### Demo users

Every `/v1` request except `/v1/health` needs the `X-User-Id` header. Without it the api returns 401.

| `X-User-Id` | Role   | Grants (seed)                         | Sees                                   |
| ----------- | ------ | ------------------------------------- | -------------------------------------- |
| `alice`     | admin  | none needed                           | everything                             |
| `bob`       | member | deny on list "Sprint"                 | Engineering › Q2 Launch › Backlog only |
| `carol`     | member | allow on space "Leadership" (private) | everything, including Leadership       |

```bash
curl -s localhost:8080/v1/tree -H 'X-User-Id: bob'
```

## Tests

```bash
make test                      # API integration tests in Docker, against the compose Postgres
```

The tests run against a separate `<db>_test` database, so they never change the demo data. Each test file resets that database to the seed.

| Spec scenario                                    | Test                                |
| ------------------------------------------------ | ----------------------------------- |
| No identity → 401                                | `apps/api/test/permissions.test.ts` |
| Tree hides private nodes for Bob; Alice sees all | `apps/api/test/permissions.test.ts` |
| Private or denied container → 403                | `apps/api/test/permissions.test.ts` |
| Hierarchy rules, reorder, move, archive          | `apps/api/test/hierarchy.test.ts`   |

Later phases add the status, custom-field and task scenarios to this table.

## Run on the host

Prerequisite: Node 24 (see `.nvmrc`). Vite+ needs Node 22.18 or later.

1. Run `nvm use` and then `pnpm install`.
2. Run `cp .env.example .env`.
3. Run `docker compose up -d db` to start only Postgres.
4. Run `pnpm --filter api migrate` and `pnpm --filter api seed`.
5. Run `pnpm dev` to start the api on port 3000 and the web app on port 5173.
6. Run `pnpm --filter api test` for the API tests on the host.

## Layout

```
apps/api
  migrations/          numbered SQL files, applied in order (schema history)
  src/app.ts           buildApp(): the Fastify app, shared by server.ts and the tests
  src/modules/         identity, permissions, hierarchy (statuses, fields, tasks next)
  src/shared/          error shape, fractional ordering, schema helpers
  test/                integration tests against a real Postgres
apps/web               React 19 on Vite+
```

- Node 24 runs the api TypeScript source directly with type stripping. There is no build step. `tsc` (TypeScript 7) only type-checks.
- Root `vite.config.ts`: Vite+ config for Oxlint (type-aware), Oxfmt, and the task runner.

## Checks

```bash
pnpm exec vp check          # format, lint, and type-check
pnpm exec vp run -r build   # api type-check and web production build
```
