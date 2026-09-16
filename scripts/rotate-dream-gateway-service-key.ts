#!/usr/bin/env tsx

// [Input] Admin private env, an explicit mode-0600 Dream backend env path and an idempotency request ID.
// [Output] Redacted dry-run/apply receipt while atomically rotating the canonical-subject key through Drizzle.
// [Pos] Release operator entry point; plaintext moves only from the private Dream env into the in-process proof/replace boundary.
// [Sync] 2026-09-16: add DTO/ORM Gateway service-key scope reconciliation without direct SQL.
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { gatewayClientForService } from "../app/lib/auth/gatewayBindings";
import {
  GatewayServiceKeyRotationService,
  gatewayServiceKeyTargetDto,
} from "../app/lib/gateway/service-key-rotation";

type Arguments = { apply: boolean; dreamEnvPath: string; requestId: string };

function parseArguments(argv: string[]): Arguments {
  let apply = false;
  let dreamEnvPath: string | undefined;
  let requestId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" && !apply) apply = true;
    else if (argument === "--dream-env" && !dreamEnvPath) dreamEnvPath = argv[++index];
    else if (argument === "--request-id" && !requestId) requestId = argv[++index];
    else throw new Error("Usage: pnpm gateway:rotate-dream-service-key --dream-env <absolute-mode-0600-path> --request-id <id> [--apply]");
  }
  if (!dreamEnvPath || !requestId) {
    throw new Error("Usage: pnpm gateway:rotate-dream-service-key --dream-env <absolute-mode-0600-path> --request-id <id> [--apply]");
  }
  return { apply, dreamEnvPath, requestId };
}

function replaceGatewayKey(source: string, plaintextKey: string) {
  const lines = source.split(/\r?\n/);
  let count = 0;
  const next = lines.map(line => {
    if (!/^INK_GATEWAY_SERVICE_KEY=/.test(line)) return line;
    count += 1;
    return `INK_GATEWAY_SERVICE_KEY=${plaintextKey}`;
  });
  if (count !== 1) throw new Error("DREAM_GATEWAY_SECRET_ENV_INVALID");
  return next.join("\n");
}

async function installPrivateEnv(path: string, source: string) {
  const temporary = `${path}.rotation-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

const arguments_ = parseArguments(process.argv.slice(2));
loadDotenv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const dreamEnvPath = resolve(arguments_.dreamEnvPath);
const [linkInfo, physicalPath, fileInfo, originalSource] = await Promise.all([
  lstat(dreamEnvPath),
  realpath(dreamEnvPath),
  stat(dreamEnvPath),
  readFile(dreamEnvPath, "utf8"),
]);
if (linkInfo.isSymbolicLink() || physicalPath !== dreamEnvPath || (fileInfo.mode & 0o777) !== 0o600) {
  throw new Error("DREAM_GATEWAY_SECRET_ENV_UNSAFE");
}
const dreamEnvironment = parseDotenv(originalSource);
const currentPlaintextKey = dreamEnvironment.INK_GATEWAY_SERVICE_KEY?.trim();
const dreamServiceClientId = dreamEnvironment.INK_ADMIN_DREAM_SERVICE_CLIENT_ID?.trim();
if (!currentPlaintextKey || !dreamServiceClientId) throw new Error("DREAM_GATEWAY_SECRET_ENV_INVALID");
const binding = gatewayClientForService(dreamServiceClientId);
const target = gatewayServiceKeyTargetDto.parse({
  serviceClientId: binding.gateway_client_id,
  scopes: ["messages:create", "messages:count_tokens", "models:list"],
  requestId: arguments_.requestId,
});
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("GATEWAY_SERVICE_KEY_DATABASE_NOT_CONFIGURED");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const database = drizzle(pool);

try {
  if (!arguments_.apply) {
    const receipt = await new GatewayServiceKeyRotationService(database).plan(target, currentPlaintextKey);
    console.log(JSON.stringify({ mode: "dry-run", ...receipt }, null, 2));
  } else {
    let envInstalled = false;
    try {
      const receipt = await database.transaction(async transaction => {
        const result = await new GatewayServiceKeyRotationService(transaction).rotate(target, currentPlaintextKey);
        if (result.plaintextKey) {
          await installPrivateEnv(dreamEnvPath, replaceGatewayKey(originalSource, result.plaintextKey));
          envInstalled = true;
        }
        return result.receipt;
      });
      console.log(JSON.stringify({ mode: "apply", ...receipt, privateEnvUpdated: envInstalled }, null, 2));
    } catch (error) {
      if (envInstalled) await installPrivateEnv(dreamEnvPath, originalSource);
      throw error;
    }
  }
} finally {
  await pool.end();
}
