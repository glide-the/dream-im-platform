#!/bin/sh
# [Input] Server-owned Admin service and Node executable configuration plus the active release's private environment.
# [Output] Execute the existing subscription period worker and emit secret-free outcome counts.
# [Pos] Local scheduler entry for the production subscription service; owns no billing rules or SQL.
# [Sync] 2026-11-12: bind scheduled execution to the active Admin release without restarting Admin.
set -eu

: "${INK_ADMIN_APP_SERVICE:?INK_ADMIN_APP_SERVICE is required}"
: "${INK_ADMIN_NODE_BIN:?INK_ADMIN_NODE_BIN is required}"

if ! systemctl is-active --quiet "$INK_ADMIN_APP_SERVICE"; then
  echo '{"error":"SUBSCRIPTION_PERIOD_ADMIN_UNAVAILABLE"}' >&2
  exit 1
fi
app_dir=$(systemctl show --property=WorkingDirectory --value "$INK_ADMIN_APP_SERVICE")
case "$app_dir" in
  /*) ;;
  *) echo '{"error":"SUBSCRIPTION_PERIOD_RELEASE_INVALID"}' >&2; exit 1 ;;
esac
if [ ! -r "$app_dir/.env.local" ] || [ ! -r "$app_dir/app/lib/subscriptions/period-worker.ts" ]; then
  echo '{"error":"SUBSCRIPTION_PERIOD_RELEASE_UNAVAILABLE"}' >&2
  exit 1
fi
cd "$app_dir"
exec "$INK_ADMIN_NODE_BIN" --env-file=.env.local --import tsx --input-type=module - <<'JS'
import { pathToFileURL } from 'node:url';

let database;
try {
  const root = pathToFileURL(`${process.cwd()}/`);
  const dbModule = await import(new URL('app/lib/db.ts', root));
  database = dbModule.default ?? dbModule;
  const workerModule = await import(new URL('app/lib/subscriptions/period-worker.ts', root));
  const worker = workerModule.default ?? workerModule;
  const results = await worker.advanceDueSubscriptions();
  const outcomes = {};
  for (const result of results) outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  console.log(JSON.stringify({ processed: results.length, outcomes }));
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code)
    ? error.code : 'SUBSCRIPTION_PERIOD_WORKER_FAILED';
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
} finally {
  if (database) {
    try {
      await database.getPool().end();
    } catch {
      console.error(JSON.stringify({ error: 'SUBSCRIPTION_PERIOD_POOL_CLOSE_FAILED' }));
      process.exitCode = 1;
    }
  }
}
JS
