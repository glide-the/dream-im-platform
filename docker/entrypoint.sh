#!/bin/sh
set -eu

echo "[entrypoint] Starting ink-memory-admin..."
if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] Applying PostgreSQL migrations..."
  node /app/scripts/migrate.mjs
fi

exec "$@"
