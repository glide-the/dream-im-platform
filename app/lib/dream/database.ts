// [Input] Explicit Admin data PostgreSQL credential and operation capability requirements.
// [Output] Typed Drizzle pool/UOW without runtime DDL or Dream-held credentials.
// [Pos] Dream data persistence boundary owned and executed by Admin.
// [Sync] 2026-09-14: require exact physical capability versions and hashes per operation.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { schemaCapabilities } from "@ink-memory/db/schema/capabilities";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";

type DataGlobal = typeof globalThis & { __ink_dream_data_pool?: Pool };
export type SchemaRequirement = { capability: string; version: number; contractSha256: string };
export function dreamDataDatabase() {
  const global = globalThis as DataGlobal;
  if (!global.__ink_dream_data_pool) {
    let dsn: URL;
    try { dsn = new URL(requiredAuthValue("DREAM_DATA_DATABASE_URL")); } catch { throw new AuthBoundaryError("DREAM_DATA_NOT_CONFIGURED"); }
    const maximum = Number(process.env.DREAM_DATA_PGPOOL_MAX ?? 10);
    if (!["postgres:", "postgresql:"].includes(dsn.protocol) || !Number.isSafeInteger(maximum) || maximum < 1) throw new AuthBoundaryError("DREAM_DATA_NOT_CONFIGURED");
    global.__ink_dream_data_pool = new Pool({ connectionString: dsn.toString(), max: maximum });
  }
  return drizzle(global.__ink_dream_data_pool);
}
export type DataDatabase = ReturnType<typeof dreamDataDatabase>;
export type DataTransaction = Parameters<Parameters<DataDatabase["transaction"]>[0]>[0];
export type DataRepositoryDatabase = DataDatabase | DataTransaction;
export async function hasSchemaCapability(database: DataRepositoryDatabase, required: SchemaRequirement) {
  const rows = await database.select({ version: schemaCapabilities.version, hash: schemaCapabilities.contractSha256 }).from(schemaCapabilities).where(eq(schemaCapabilities.capability, required.capability)).limit(1);
  return rows[0]?.version === required.version && rows[0].hash === required.contractSha256;
}
export async function withDataTransaction<T>(requirements: readonly SchemaRequirement[], handler: (transaction: DataTransaction) => Promise<T>, database = dreamDataDatabase()) {
  return database.transaction(async tx => {
    for (const required of requirements) if (!await hasSchemaCapability(tx, required)) throw new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY");
    return handler(tx);
  });
}
