// [Input] A fixed internal codec name, structured facts and the configured domain deadline.
// [Output] Safely transported pure JSON result without credentials, shell, database or source execution.
// [Pos] Reusable pure-codec transport; internal callers cannot choose a path or executable.
// [Sync] 2026-09-15: add the verified SystemConfig codec without exposing executable selection.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";

const fixedCodecs = { launchEnvelope: "dreamLaunchEnvelope.py", launchFailureEnvelope: "dreamLaunchFailureEnvelope.py", userSystemConfig: "userSystemConfigCodec.py" } as const;
export async function invokeFixedDomainCodec(codec: keyof typeof fixedCodecs, input: unknown): Promise<unknown> {
  const timeout = Number(requiredAuthValue("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS"));
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new AuthBoundaryError("DREAM_CODEC_NOT_CONFIGURED");
  return new Promise((done, reject) => {
    const child = spawn("python3", ["-I", "-S", resolve(process.cwd(), "app/lib/dream", fixedCodecs[codec])],
      { shell: false, env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, stdio: "pipe" });
    const chunks: Buffer[] = []; let failed = false;
    const failure = () => { if (!failed) { failed = true; clearTimeout(timer); reject(new AuthBoundaryError("DREAM_CODEC_UNAVAILABLE")); } };
    const timer = setTimeout(() => { child.kill(); failure(); }, timeout);
    child.stdout.on("data", chunk => chunks.push(chunk)); child.stderr.resume();
    child.on("error", failure); child.stdin.on("error", failure);
    child.on("close", code => { clearTimeout(timer); if (failed) return; if (code !== 0) return failure();
      try { done(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { failure(); } });
    child.stdin.end(JSON.stringify(input));
  });
}
