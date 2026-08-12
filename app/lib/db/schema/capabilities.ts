import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const drizzleSchema = pgSchema("drizzle");

/**
 * Machine-readable schema features required by independently deployed domains.
 * Applications depend on capabilities, never the global Drizzle journal head.
 */
export const schemaCapabilities = drizzleSchema.table(
  "schema_capabilities",
  {
    capability: text("capability").primaryKey(),
    version: integer("version").notNull(),
    contractSha256: text("contract_sha256").notNull(),
    adoptedFrom: text("adopted_from").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    check("schema_capabilities_version_check", sql`${table.version} >= 1`),
    check(
      "schema_capabilities_contract_sha256_check",
      sql`${table.contractSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
