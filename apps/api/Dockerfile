# Build context is the repo root: the pnpm workspace and lockfile live there.
FROM node:24-alpine AS base
RUN npm install --global pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/

# Test image: dev dependencies too (vite-plus brings Vitest). Used by `make test`.
FROM base AS test
RUN pnpm install --frozen-lockfile --filter api --filter flowboard
COPY vite.config.ts tsconfig.json ./
COPY apps/api apps/api
WORKDIR /app/apps/api
CMD ["pnpm", "exec", "vp", "test"]

# Runtime image: production dependencies only. Last stage, so a plain build picks it.
FROM base AS runtime
RUN pnpm install --frozen-lockfile --prod --filter api
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 3000
# Migrate and seed on every boot. Both are idempotent and hold an advisory lock.
CMD ["sh", "-c", "node src/migrate.ts && node src/seed.ts && exec node src/server.ts"]
