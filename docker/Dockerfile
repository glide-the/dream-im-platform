# ============================================
# Stage 1: Build
# ============================================
FROM node:22-alpine AS builder

ARG DOCKER_BUILD="1"
WORKDIR /app

# Use Alibaba Cloud mirror for apk (faster in China)
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# Enable pnpm via corepack
RUN corepack enable pnpm

# Copy dependency manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Configure pnpm to use Taobao registry (faster in China)
RUN pnpm config set registry https://registry.npmmirror.com/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Enable Next.js standalone output via env
# See: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
ENV NEXT_STANDALONE_OUTPUT="true"

# Build the application
RUN pnpm build

# ============================================
# Stage 2: Production Runner
# ============================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Use Alibaba Cloud mirror for apk
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy standalone output (includes server.js and node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy drizzle migrations for runtime DB migration
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Copy entrypoint script
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Create agent-workspaces directory with correct ownership
RUN mkdir -p /app/agent-workspaces && chown -R nextjs:nodejs /app/agent-workspaces

USER nextjs

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Use entrypoint for pre-start tasks (e.g., DB migrations)
ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]

# server.js is created by next build from the standalone output
CMD ["node", "server.js"]
