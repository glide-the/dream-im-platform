import { URL } from "node:url";
import { spawn } from "node:child_process";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl || process.env.ALLOW_EPHEMERAL_DB_PUSH !== "1") {
  throw new Error(
    "db:push is restricted to an explicitly approved ephemeral database (set MIGRATION_DATABASE_URL and ALLOW_EPHEMERAL_DB_PUSH=1)",
  );
}
const target = new URL(databaseUrl);
const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
if (
  !loopback.has(target.hostname)
  || !/(?:test|codex|ephemeral|scratch)/i.test(target.pathname.slice(1))
) {
  throw new Error("db:push target is not an explicitly named loopback test database");
}

const child = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "drizzle-kit", "push"],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
