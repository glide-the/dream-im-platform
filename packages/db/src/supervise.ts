// [Input] Container command plus explicit embedded PostgreSQL configuration.
// [Output] One supervised process tree containing PostgreSQL and the requested Admin command.
// [Pos] Container runtime entry owned by @ink-memory/db; it deliberately never migrates.
// [Sync] 2026-08-21: supervise embedded PostgreSQL and Admin in one container.
// [Sync] 2026-10-05: supervise the whole command group and always stop PostgreSQL on command failure.
import { startEmbeddedPostgres } from "./embedded-postgres.js";
import { postgresConnectionString, resolveEmbeddedPostgresConfig, resolveSupervisorShutdownTimeoutMs } from "./runtime-config.js";
import { superviseCommand, type CommandOutcome } from "./supervised-command.js";

if (process.env.RUN_DB_MIGRATIONS === "true") {
  throw new Error("RUN_DB_MIGRATIONS=true is forbidden; run the package migration command during release.");
}
const command = process.argv.slice(2);
if (!command.length) throw new Error("Database supervisor requires an application or maintenance command.");
const config = resolveEmbeddedPostgresConfig();
const shutdownTimeoutMs = resolveSupervisorShutdownTimeoutMs();
const database = await startEmbeddedPostgres(config);
const localUrl = postgresConnectionString(config);
let databaseStop: Promise<void> | undefined;
const stopDatabase = () => databaseStop ??= database.stop();
let outcome: CommandOutcome;
try {
  outcome = await superviseCommand({
    command,
    shutdownTimeoutMs,
    cleanup: stopDatabase,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || localUrl,
      MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL || localUrl,
    },
  });
} finally {
  // Also covers a synchronous spawn/configuration error before the helper
  // installs its lifecycle listeners; repeated calls share the same stop.
  await stopDatabase();
}
// superviseCommand has removed its signal handlers before the original signal
// is re-raised; it must terminate this process rather than forward a second time.
if (outcome.signal) process.kill(process.pid, outcome.signal);
else process.exitCode = outcome.code ?? 1;
