# [Input] pnpm workspace sources, @ink-memory/db, immutable Drizzle history, and Next.js app.
# [Output] Single Admin image supervising embedded PostgreSQL and explicit migration tools.
# [Pos] Shared local/Alibaba Cloud production image; no separate database or MinIO image is required.
# [Sync] 2026-08-21: pin PG18 maintenance clients to the embedded server major.
FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/db/package.json packages/db/package.json
COPY patches/ patches/
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_BUILD_CPUS=1
ARG NEXT_BUILD_MAX_OLD_SPACE_MB=1024
ENV NEXT_BUILD_CPUS=${NEXT_BUILD_CPUS}
ENV NODE_OPTIONS=--max-old-space-size=${NEXT_BUILD_MAX_OLD_SPACE_MB}
ENV NEXT_STANDALONE_OUTPUT=true
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
RUN pnpm --filter @ink-memory/db deploy --prod /db-runtime

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV HOME=/home/node

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gosu tini \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl --fail --silent --show-error \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && printf '%s\n' \
    'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /db-runtime ./packages/db
COPY docker/entrypoint.sh /usr/local/bin/ink-memory-entrypoint
RUN chmod +x /usr/local/bin/ink-memory-entrypoint

EXPOSE 3000 5432
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:3000/admin/login || exit 1
ENTRYPOINT ["tini", "--", "/usr/local/bin/ink-memory-entrypoint"]
CMD ["node", "server.js"]
