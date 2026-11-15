// [Input] Explicit Admin data PostgreSQL credential and operation capability requirements.
// [Output] Typed Drizzle pool/UOW without runtime DDL or Dream-held credentials.
// [Pos] Dream data persistence boundary owned and executed by Admin.
// [Sync] 2026-09-14: require exact physical capability versions and hashes per operation.
// [Sync] 2026-11-16: batch request-local ledger reads and deduplicate exact requirements inside the original transaction.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
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
export async function readSchemaCapabilities(database: DataRepositoryDatabase, requirements: readonly SchemaRequirement[]) {
  const names = [...new Set(requirements.map(required => required.capability))];
  if (!names.length) return new Map<string, SchemaRequirement>();
  const rows = await database.select({ capability: schemaCapabilities.capability, version: schemaCapabilities.version, contractSha256: schemaCapabilities.contractSha256 })
    .from(schemaCapabilities).where(inArray(schemaCapabilities.capability, names));
  return new Map(rows.map(row => [row.capability, row]));
}
export function schemaCapabilityMatches(ledger: ReadonlyMap<string, SchemaRequirement>, required: SchemaRequirement) {
  const actual = ledger.get(required.capability);
  return actual?.version === required.version && actual.contractSha256 === required.contractSha256;
}
export async function hasSchemaCapability(database: DataRepositoryDatabase, required: SchemaRequirement) {
  return schemaCapabilityMatches(await readSchemaCapabilities(database, [required]), required);
}
export async function withDataTransaction<T>(requirements: readonly SchemaRequirement[], handler: (transaction: DataTransaction) => Promise<T>, database = dreamDataDatabase()) {
  return database.transaction(async tx => {
    const unique = new Map<string, SchemaRequirement>();
    for (const required of requirements) {
      if (unique.has(required.capability) && !schemaCapabilityMatches(unique, required)) throw new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY");
      unique.set(required.capability, required);
    }
    const ledger = await readSchemaCapabilities(tx, [...unique.values()]);
    if (![...unique.values()].every(required => schemaCapabilityMatches(ledger, required))) throw new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY");
    return handler(tx);
  });
}
