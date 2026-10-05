// [Input] An explicit command/environment and configured process-shutdown deadline.
// [Output] Command outcome after closing its owned process group and output pipes.
// [Pos] Database-independent process lifecycle used by the PostgreSQL supervisor.
// [Sync] 2026-10-05: forward terminal hangup, reap descendants, and bound failed shutdown.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export type CommandOutcome = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export async function superviseCommand(input: {
  command: readonly string[];
  env: NodeJS.ProcessEnv;
  shutdownTimeoutMs: number;
  cleanup?: () => Promise<void>;
}): Promise<CommandOutcome> {
  if (!input.command.length) throw new Error("Supervisor requires a command.");
  if (!Number.isSafeInteger(input.shutdownTimeoutMs) || input.shutdownTimeoutMs <= 0 || input.shutdownTimeoutMs > 2_147_483_647) {
    throw new RangeError("Supervisor shutdown timeout must be a positive Node timer duration.");
  }

  const useProcessGroup = process.platform !== "win32";
  const child = spawn(input.command[0], input.command.slice(1), {
    detached: useProcessGroup,
    stdio: ["inherit", "pipe", "pipe"],
    env: input.env,
  });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let forwardedSignal: NodeJS.Signals | null = null;
  let outputFailed = false;
  let commandFinished = false;
  let forceRequested = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let shutdownDeadline: number | undefined;

  const sendSignal = (signal: NodeJS.Signals) => {
    if (!child.pid || commandFinished) return;
    try {
      if (useProcessGroup) process.kill(-child.pid, signal);
      else if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  const groupIsAlive = () => {
    if (!child.pid) return false;
    if (!useProcessGroup) return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
      throw error;
    }
  };
  const forceStop = () => {
    if (forceRequested) return;
    forceRequested = true;
    sendSignal("SIGKILL");
  };
  const requestStop = (signal: NodeJS.Signals) => {
    if (!shutdownTimer) {
      shutdownDeadline = performance.now() + input.shutdownTimeoutMs;
      shutdownTimer = setTimeout(forceStop, input.shutdownTimeoutMs);
    }
    sendSignal(signal);
  };
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
  const signalHandlers = signals.map((signal) => {
    const handler = () => {
      forwardedSignal ??= signal;
      requestStop(signal);
    };
    process.on(signal, handler);
    return handler;
  });
  const discardOutput = () => {
    child.stdout.unpipe(process.stdout);
    child.stderr.unpipe(process.stderr);
    child.stdout.resume();
    child.stderr.resume();
  };
  const outputError = () => {
    outputFailed = true;
    discardOutput();
    // The output destination is broken; reporting the error there would recurse.
    requestStop("SIGTERM");
  };
  process.stdout.on("error", outputError);
  process.stderr.on("error", outputError);
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });

  let outcome: CommandOutcome;
  try {
    outcome = await new Promise<CommandOutcome>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    // A pnpm/shell parent can exit before its Next.js descendant. Ownership is
    // the process group, so parent exit does not finish cleanup by itself.
    requestStop("SIGTERM");
    while (!forceRequested && groupIsAlive()) {
      if (performance.now() >= shutdownDeadline) {
        forceStop();
        break;
      }
      await delay(Math.min(50, Math.max(1, shutdownDeadline - performance.now())));
    }
    await closed;
    commandFinished = true;
  } catch (error) {
    forceStop();
    await closed;
    commandFinished = true;
    throw error;
  } finally {
    try {
      // Resource shutdown may also emit logs. Keep failed-output protection
      // installed until the owner has stopped its resources.
      await input.cleanup?.();
    } finally {
      if (shutdownTimer) clearTimeout(shutdownTimer);
      signals.forEach((signal, index) => process.removeListener(signal, signalHandlers[index]));
      child.stdout.unpipe(process.stdout);
      child.stderr.unpipe(process.stderr);
      process.stdout.removeListener("error", outputError);
      process.stderr.removeListener("error", outputError);
    }
  }
  return outputFailed ? { code: 1, signal: null } : {
    code: outcome.code,
    signal: forwardedSignal ?? outcome.signal,
  };
}
