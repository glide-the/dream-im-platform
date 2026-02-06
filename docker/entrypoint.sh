#!/bin/sh
set -e

# Fix ownership for agent-workspaces volume if running as root
APP_UID="${APP_UID:-1001}"
APP_GID="${APP_GID:-1001}"

if [ "$(id -u)" = "0" ]; then
  chown -R "$APP_UID:$APP_GID" /app/agent-workspaces 2>/dev/null || true
fi

echo "[entrypoint] Starting ai4sales-pwa-app..."
exec "$@"
