#!/usr/bin/env tsx

// [Input] Private Admin env, one explicit Admin email, optional --apply and two hidden TTY password entries.
// [Output] Redacted dry-run/apply receipt; plaintext password never enters argv, env, logs or persisted audit.
// [Pos] Local lockout recovery entry point backed by Admin DTO/service/typed Drizzle and the control credential.
// [Sync] 2026-09-17: add default-dry-run independent Admin password recovery with Session revocation.
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  closeAuthDatabaseConnections,
  withAdminAuthControlTransaction,
} from "../app/lib/auth/database";
import {
  applyAdminPasswordRecovery,
  planAdminPasswordRecovery,
} from "../app/lib/auth/adminPasswordRecovery";

type Arguments = { apply: boolean; email: string };

function parseArguments(argv: string[]): Arguments {
  let apply = false;
  let email: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" && !apply) apply = true;
    else if (argument === "--email" && !email) email = argv[++index];
    else throw new Error("Usage: pnpm auth:reset-admin-password --email <admin-email> [--apply]");
  }
  if (!email) throw new Error("Usage: pnpm auth:reset-admin-password --email <admin-email> [--apply]");
  return { apply, email };
}

async function readHidden(label: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("ADMIN_PASSWORD_RECOVERY_REQUIRES_TTY");
  }
  const previousRaw = input.isRaw;
  const decoder = new StringDecoder("utf8");
  output.write(label);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolvePromise, rejectPromise) => {
    let value = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.setRawMode(Boolean(previousRaw));
      input.pause();
      output.write("\n");
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") return finish(new Error("ADMIN_PASSWORD_RECOVERY_CANCELLED"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    const onEnd = () => finish(new Error("ADMIN_PASSWORD_RECOVERY_TTY_CLOSED"));
    const onError = () => finish(new Error("ADMIN_PASSWORD_RECOVERY_TTY_FAILED"));
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
  });
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  loadDotenv({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  const requestId = `admin_password_recovery_${randomUUID().replaceAll("-", "")}`;
  try {
    if (!arguments_.apply) {
      const receipt = await withAdminAuthControlTransaction(tx => planAdminPasswordRecovery(tx, {
        email: arguments_.email,
        requestId,
      }));
      console.log(JSON.stringify(receipt, null, 2));
      return;
    }
    const password = await readHidden("New Admin password (14-256 characters): ");
    const confirmation = await readHidden("Repeat new Admin password: ");
    if (password !== confirmation) throw new Error("ADMIN_PASSWORD_RECOVERY_CONFIRMATION_MISMATCH");
    const receipt = await withAdminAuthControlTransaction(tx => applyAdminPasswordRecovery(tx, {
      email: arguments_.email,
      password,
      requestId,
    }));
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await closeAuthDatabaseConnections();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "ADMIN_PASSWORD_RECOVERY_FAILED");
  process.exitCode = 1;
});
