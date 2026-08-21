// [Input] Container command plus explicit embedded PostgreSQL configuration.
// [Output] One supervised process tree containing PostgreSQL and the requested Admin command.
// [Pos] Container runtime entry owned by @ink-memory/db; it deliberately never migrates.
// [Sync] 2026-08-21: supervise embedded PostgreSQL and Admin in one container.
import { spawn } from "node:child_process";
import { startEmbeddedPostgres } from "./embedded-postgres.js";
import { postgresConnectionString, resolveEmbeddedPostgresConfig } from "./runtime-config.js";

if (process.env.RUN_DB_MIGRATIONS === "true") {
  throw new Error("RUN_DB_MIGRATIONS=true is forbidden; run the package migration command during release.");
}
const command = process.argv.slice(2);
if (!command.length) throw new Error("Database supervisor requires an application or maintenance command.");
const config = resolveEmbeddedPostgresConfig();
const database = await startEmbeddedPostgres(config);
const localUrl = postgresConnectionString(config);
const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || localUrl,
    MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL || localUrl,
  },
});

let forwardedSignal: NodeJS.Signals | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    forwardedSignal = signal;
    if (child.exitCode === null) child.kill(signal);
  });
}
const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => resolve({ code, signal }));
});
await database.stop();
const terminalSignal = outcome.signal || forwardedSignal;
if (terminalSignal) process.kill(process.pid, terminalSignal);
else process.exitCode = outcome.code ?? 1;
