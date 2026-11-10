# Build context is the repo root: the pnpm workspace and lockfile live there.
FROM node:24-alpine
RUN npm install --global pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter api
COPY apps/api/src apps/api/src
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
