#!/bin/sh
# [Input] Embedded PostgreSQL volume/config plus an Admin or maintenance command.
# [Output] Non-root supervised PostgreSQL and command process tree.
# [Pos] Container permission boundary before @ink-memory/db takes lifecycle ownership.
# [Sync] 2026-08-21: replace optional startup migration with embedded database supervision.
set -eu

database_dir="${EMBEDDED_POSTGRES_DATA_DIR:-/var/lib/ink-memory/postgres}"
artifact_dir="${ARTIFACT_WORKSPACE_ROOT:-/artifacts}"
mkdir -p "${database_dir}" "${artifact_dir}"
if [ "$(stat -c '%u' "${database_dir}")" != "$(id -u node)" ]; then
  chown -R node:node "${database_dir}"
fi
if [ "$(stat -c '%u' "${artifact_dir}")" != "$(id -u node)" ]; then
  chown -R node:node "${artifact_dir}"
fi

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] RUN_DB_MIGRATIONS=true is forbidden; use the release migration step." >&2
  exit 1
fi

exec gosu node node /app/packages/db/dist/supervise.js "$@"
