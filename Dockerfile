# syntax=docker/dockerfile:1

# pagador.ao API — one image, three roles: HTTP API (dist/main), worker (dist/worker) and
# migrations + seed (prisma migrate deploy && dist/seed). See docker-compose.yml.

FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  npm_config_fetch_timeout=300000 npm_config_fetch_retries=5 npm_config_network_concurrency=8
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY prisma ./prisma
RUN pnpm exec prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY prisma ./prisma
RUN pnpm exec prisma generate
COPY --from=build /app/dist ./dist
COPY templates ./templates
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3333)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]
