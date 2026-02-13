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

# Install tools required by Claude Agent SDK and common agent operations:
#   Shell:   bash (SDK requires bash/zsh, Alpine only has busybox sh)
#   File:    coreutils findutils grep sed gawk tar gzip unzip xz patch diffutils file tree jq yq
#   Network: curl wget bind-tools openssh-client socat
#   Process: procps-ng (ps/top/pgrep/pkill) shadow (useradd etc.)
#   VCS:     git
#   Editor:  vim
#   Runtime: python3 + pip (for agent code-execution tasks)
#   Build:   make gcc musl-dev (for native Python packages)
RUN apk add --no-cache \
    bash coreutils findutils \
    grep sed gawk \
    tar gzip unzip xz patch diffutils file tree \
    jq yq \
    curl wget bind-tools openssh-client socat \
    procps-ng shadow \
    git vim \
    python3 py3-pip python3-dev \
    make gcc musl-dev \
  && ln -sf /usr/bin/python3 /usr/bin/python

ENV SHELL="/bin/bash"

# Copy standalone output (includes server.js and node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy claude-agent-sdk cli.js (resolved at runtime via import.meta.url, not traced by Next.js)
# Must copy both the hoisted path and the pnpm store path since import.meta.url resolves to .pnpm
COPY --from=builder /app/node_modules/@anthropic-ai/claude-agent-sdk /app/node_modules/@anthropic-ai/claude-agent-sdk
COPY --from=builder /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.20_zod@4.3.6 /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.20_zod@4.3.6

# Copy drizzle migrations for runtime DB migration
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Copy entrypoint script
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Create agent-workspaces directory
RUN mkdir -p /app/agent-workspaces

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Use entrypoint for pre-start tasks (e.g., DB migrations)
ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]

# server.js is created by next build from the standalone output
CMD ["node", "server.js"]
