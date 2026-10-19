# Una imagen para la web y otra (tools) para migraciones, datos de demo y scrapers.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/matching/package.json packages/matching/
COPY packages/scrapers/package.json packages/scrapers/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# Migraciones, seed y scrapers corren con tsx desde el código fuente.
FROM source AS tools
ENV NODE_ENV=production
CMD ["pnpm", "db:migrate"]

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
