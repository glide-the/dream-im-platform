#!/usr/bin/env bash
# [Input] Exported launcher paths and the mode-0640 Admin runtime env.
# [Output] One foreground Admin process tree supervising embedded PostgreSQL.
# [Pos] AutoDL screen-session entrypoint; migrations remain a release step.
# [Sync] 2026-08-26: enforce /root/ink-autodl/data/postgres at process start.
set -euo pipefail

: "${AUTODL_ADMIN_ENV_FILE:?AUTODL_ADMIN_ENV_FILE is required}"
: "${AUTODL_ADMIN_PID_FILE:?AUTODL_ADMIN_PID_FILE is required}"
: "${AUTODL_NODE_BIN:?AUTODL_NODE_BIN is required}"

set -a
# shellcheck disable=SC1090
. "${AUTODL_ADMIN_ENV_FILE}"
set +a
export PATH="${AUTODL_NODE_BIN}:${PATH}"

expected_postgres_dir="${HOME:?HOME is required}/postgres"
[[ "${EMBEDDED_POSTGRES_DATA_DIR:-}" == "${expected_postgres_dir}" ]] || {
  printf '[admin-start:error] EMBEDDED_POSTGRES_DATA_DIR must equal %s.\n' "${expected_postgres_dir}" >&2
  exit 1
}
[[ -d "${expected_postgres_dir}" && ! -L "${expected_postgres_dir}" && -O "${expected_postgres_dir}" ]] || {
  printf '[admin-start:error] PostgreSQL data directory is missing, symlinked, or not service-owned.\n' >&2
  exit 1
}
chmod 0700 "${expected_postgres_dir}"
[[ -n "${ARTIFACT_WORKSPACE_ROOT:-}" && -d "${ARTIFACT_WORKSPACE_ROOT}" && ! -L "${ARTIFACT_WORKSPACE_ROOT}" ]] || {
  printf '[admin-start:error] Shared Artifact root is missing or symlinked.\n' >&2
  exit 1
}

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s\n' "$$" >"${AUTODL_ADMIN_PID_FILE}"
exec node packages/db/dist/supervise.js node server.js
