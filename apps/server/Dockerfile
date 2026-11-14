# syntax=docker/dockerfile:1.7

# Builds the API bundle. The workspace install and TypeScript toolchain stay in
# this stage; only the runner below ships to production.
FROM node:24-slim AS builder
RUN npm install -g pnpm@12.11.2
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local \
    --mount=type=secret,id=server_env,target=/app/apps/server/.env.local \
    --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local \
    --mount=type=secret,id=server_env,target=/app/apps/server/.env.local \
    pnpm --filter server build

# One-shot migrations. Only the schema, migrations, config, and Prisma CLI are
# copied, so this image does not carry the application or the workspace install.
FROM node:24-slim AS migrate
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/packages/db
ENV NODE_ENV=production
COPY packages/db/prisma.config.ts ./
COPY packages/db/prisma ./prisma
COPY packages/db/.env.schema ./.env.schema
COPY apps/server/.env.schema /app/apps/server/.env.schema
# Type generation is a build-time step; production must not write into its own
# source tree. `auto=false` leaves validation on and skips codegen.
RUN sed -i 's/exposeEnv=local)/exposeEnv=local, auto=false)/' \
        ./.env.schema /app/apps/server/.env.schema
RUN --mount=type=cache,target=/root/.npm \
    printf '{"name":"lattice-migrate","private":true,"type":"module"}\n' > package.json \
    && npm install --no-save --no-package-lock prisma@7.10.1 varlock@1.23.0
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# The runtime manifest mirrors what tsdown leaves external in dist/index.mjs.
# `pnpm --filter server build` fails if the bundle imports anything else.
FROM node:24-slim AS runtime-deps
RUN npm install -g pnpm@12.11.2
WORKDIR /runtime
COPY apps/server/runtime.package.json ./package.json
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --prod --ignore-scripts --store-dir /pnpm-store

# Production image: the bundle, its external dependencies, and the env schema.
FROM node:24-slim AS runner
WORKDIR /app/apps/server
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder --chown=node:node /app/apps/server/dist ./dist
COPY --from=builder --chown=node:node /app/apps/server/.env.schema ./.env.schema
COPY --from=runtime-deps --chown=node:node /runtime/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /runtime/package.json ./package.json

RUN sed -i 's/exposeEnv=local)/exposeEnv=local, auto=false)/' ./.env.schema \
    && mkdir -p storage/uploads \
    && chown -R node:node storage
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.mjs"]
