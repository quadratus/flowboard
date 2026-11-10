# Flowboard

A small project-management app: a space, folder, and list hierarchy, kanban and list views, scoped statuses, and custom fields.

## Run with Docker

Prerequisite: Docker with Compose v2.

```bash
docker compose up --build
```

| Service | URL                   | Notes                                     |
| ------- | --------------------- | ----------------------------------------- |
| web     | http://localhost:8080 | React app; nginx proxies `/v1` → api      |
| api     | http://localhost:3000 | Fastify; `GET /v1/health`                 |
| db      | localhost:5432        | Postgres 18, user/password/db `flowboard` |

Copy `.env.example` to `.env` to change ports or credentials. The stack also starts without a `.env` file.

## Run on the host

Prerequisite: Node 24 (see `.nvmrc`). Vite+ needs Node 22.18 or later.

1. Run `nvm use` and then `pnpm install`.
2. Run `cp .env.example .env`.
3. Run `docker compose up -d db` to start only Postgres.
4. Run `pnpm dev` to start the api on port 3000 and the web app on port 5173.

## Layout

- `apps/api`: Node 24 runs the TypeScript source directly with type stripping. There is no build step. `tsc` (TypeScript 7) only type-checks.
- `apps/web`: React 19 on Vite+.
- Root `vite.config.ts`: Vite+ config for Oxlint (type-aware), Oxfmt, and the task runner.

## Checks

```bash
pnpm exec vp check          # format, lint, and type-check
pnpm exec vp run -r build   # api type-check and web production build
```
