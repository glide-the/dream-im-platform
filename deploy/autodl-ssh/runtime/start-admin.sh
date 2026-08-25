#!/usr/bin/env bash
# [Input] Exported launcher paths and the mode-0640 Admin runtime env.
# [Output] One foreground Admin process tree supervising embedded PostgreSQL.
# [Pos] AutoDL screen-session entrypoint; migrations remain a release step.
# [Sync] 2026-08-26: add direct-host Admin/embedded-PG supervision without Docker.
set -euo pipefail

: "${AUTODL_ADMIN_ENV_FILE:?AUTODL_ADMIN_ENV_FILE is required}"
: "${AUTODL_ADMIN_PID_FILE:?AUTODL_ADMIN_PID_FILE is required}"
: "${AUTODL_NODE_BIN:?AUTODL_NODE_BIN is required}"

set -a
# shellcheck disable=SC1090
. "${AUTODL_ADMIN_ENV_FILE}"
set +a
export PATH="${AUTODL_NODE_BIN}:${PATH}"

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s\n' "$$" >"${AUTODL_ADMIN_PID_FILE}"
exec node packages/db/dist/supervise.js node server.js
