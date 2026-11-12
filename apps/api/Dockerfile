# Build context is the repo root: the pnpm workspace and lockfile live there.
FROM node:24-alpine
RUN npm install --global pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter api
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 3000
# Migrate and seed on every boot. Both are idempotent and hold an advisory lock.
CMD ["sh", "-c", "node src/migrate.ts && node src/seed.ts && exec node src/server.ts"]
