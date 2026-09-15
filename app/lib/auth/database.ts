// [Input] Explicit dedicated auth PostgreSQL credential and Drizzle capability ledger.
// [Output] Typed ORM transaction, capability gate and one Admin-owned auth connection pool.
// [Pos] Authentication repository/UOW boundary; never runs migrations at startup.
// [Sync] 2026-09-14: require explicit dedicated database capability without environment-name fallbacks.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { schemaCapabilities } from "@ink-memory/db/schema/capabilities";
import { AuthBoundaryError, requiredAuthValue } from "./config";
import identityContract from "../../../drizzle/contracts/identity-better-auth-v1.json";

type AuthGlobal = typeof globalThis & { __ink_auth_pool?: Pool; __ink_admin_auth_control_pool?: Pool };
export const authSchemaCapability = "identity.better-auth.v1";

export function authDatabase() {
  const global = globalThis as AuthGlobal;
  if (!global.__ink_auth_pool) {
    const dsn = requiredAuthValue("AUTH_DATABASE_URL");
    let parsed: URL;
    try { parsed = new URL(dsn); } catch { throw new AuthBoundaryError("AUTH_NOT_CONFIGURED"); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new AuthBoundaryError("AUTH_NOT_CONFIGURED");
    const maximum = Number(process.env.AUTH_PGPOOL_MAX ?? 10);
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new AuthBoundaryError("AUTH_NOT_CONFIGURED");
    global.__ink_auth_pool = new Pool({ connectionString: dsn, max: maximum });
  }
  return drizzle(global.__ink_auth_pool);
}

export type AuthDatabase = ReturnType<typeof authDatabase>;
export type AuthTransaction = Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0];
export type AuthRepositoryDatabase = AuthDatabase | AuthTransaction;

export async function assertAuthCapability(database: AuthRepositoryDatabase) {
  const rows = await database.select({ capability: schemaCapabilities.capability }).from(schemaCapabilities)
    .where(and(eq(schemaCapabilities.capability, authSchemaCapability), eq(schemaCapabilities.version, 1), eq(schemaCapabilities.contractSha256, identityContract.contract_sha256)));
  if (!rows.length) throw new AuthBoundaryError("AUTH_SCHEMA_NOT_READY");
}

// The explicit control credential alone can seed Admin roles/memberships.
export function adminAuthControlDatabase() {
  const global = globalThis as AuthGlobal;
  if (!global.__ink_admin_auth_control_pool) {
    const dsn = requiredAuthValue("ADMIN_CONTROL_DATABASE_URL");
    let url: URL; try { url = new URL(dsn); } catch { throw new AuthBoundaryError("ADMIN_CONTROL_NOT_CONFIGURED"); }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new AuthBoundaryError("ADMIN_CONTROL_NOT_CONFIGURED");
    global.__ink_admin_auth_control_pool = new Pool({ connectionString: dsn, max: 1 });
  }
  return drizzle(global.__ink_admin_auth_control_pool);
}
export async function withAdminAuthControlTransaction<T>(handler: (transaction: AuthTransaction) => Promise<T>) {
  return withAuthTransaction(handler, adminAuthControlDatabase());
}

export async function withAuthTransaction<T>(handler: (transaction: AuthTransaction) => Promise<T>, database = authDatabase()) {
  return database.transaction(async tx => {
    await assertAuthCapability(tx);
    return handler(tx);
  });
}
