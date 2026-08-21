// [Input] Legacy migration CLI arguments.
// [Output] Compatibility handoff to the @ink-memory/db workspace command.
// [Pos] Deprecated root shim; package scripts are the authoritative entry.
// [Sync] 2026-08-21: move migration execution into packages/db.
import { spawn } from "node:child_process";

const child = spawn("pnpm", ["--filter", "@ink-memory/db", "migrate", ...process.argv.slice(2)], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
});
child.on("error", (error) => { throw error; });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
