// [Input] Installed Better Auth schema, Drizzle declarations and frozen expand migration/snapshot.
// [Output] Source descriptor, SQL capability ordering and immutable-candidate integrity evidence.
// [Pos] Provider-free auth schema contract checks; never executes migrations.
// [Sync] 2026-09-16: verify additive confirmation-claim binding against current Drizzle ORM.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { betterAuthSchema } from "@ink-memory/db/schema/auth-generated";
import { adminSubjectLinks, browserSessions, operationReceipts, runtimeDelegations, subjectLinks } from "@ink-memory/db/schema/auth";
import contract from "../../../drizzle/contracts/identity-better-auth-v1.json";
import snapshot from "../../../drizzle/meta/0054_snapshot.json";
import runtimeContract from "../../../drizzle/contracts/identity-runtime-delegation-v1.json";
import runtimeSnapshot from "../../../drizzle/meta/0055_snapshot.json";
import registrationContract from "../../../drizzle/contracts/identity-registration-integrity-v1.json";
import registrationSnapshot from "../../../drizzle/meta/0056_snapshot.json";
import purposeContract from "../../../drizzle/contracts/identity-runtime-purpose-v1.json";
import purposeSnapshot from "../../../drizzle/meta/0058_snapshot.json";
import confirmationClaimContract from "../../../drizzle/contracts/identity-runtime-confirmation-claim-v1.json";
import confirmationClaimSnapshot from "../../../drizzle/meta/0062_snapshot.json";
import { canonicalContractJson } from "../dream/operationRegistry";
const migration = readFileSync("drizzle/0054_clean_network.sql", "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
describe("frozen identity expand migration", () => {
  it("matches all protocol and application ORM columns to snapshot/descriptor", () => {
    const tables = [...Object.values(betterAuthSchema), subjectLinks, adminSubjectLinks, browserSessions, runtimeDelegations, operationReceipts];
    expect(tables).toHaveLength(18);
    for (const table of tables) {
      const config = getTableConfig(table); const key = `${config.schema}.${config.name}` as keyof typeof contract.tables;
      expect(contract.tables[key]).toEqual(snapshot.tables[key]);
      const columns = contract.tables[key].columns as Record<string, { type: string; notNull: boolean }>;
      // Later additive migrations may expand application delegation fields.
      // This immutable 0054 contract still verifies every original column.
      const originalColumns = config.columns.filter(column => column.name in columns);
      expect(originalColumns.map(column => column.name).sort()).toEqual(Object.keys(columns).sort());
      for (const column of originalColumns) {
        expect(column.getSQLType()).toBe(columns[column.name].type);
        expect(column.notNull).toBe(columns[column.name].notNull);
      }
    }
    expect(sha(canonicalContractJson({ version: contract.version, tables: contract.tables }))).toBe(contract.contract_sha256);
  });
  it("creates real schemas and publishes the capability after constraints/indexes", () => {
    expect(migration.startsWith('CREATE SCHEMA "identity";')).toBe(true);
    expect(migration.indexOf('CREATE SCHEMA "dream";')).toBeLessThan(migration.indexOf('CREATE TABLE "dream".'));
    expect(migration.lastIndexOf("identity.better-auth.v1")).toBeGreaterThan(migration.lastIndexOf("CREATE INDEX"));
    expect(migration).toContain(contract.contract_sha256);
    for (const target of ["oauthClient", "oauthResource"]) {
      const uniqueIndex = target === "oauthClient" ? "identity_oauthClient_clientId_idx" : "identity_oauthResource_identifier_idx";
      expect(migration.indexOf(`CREATE UNIQUE INDEX "${uniqueIndex}"`)).toBeLessThan(migration.indexOf(`REFERENCES "identity"."${target}"`));
    }
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)|TRUNCATE|UPDATE\s+"?users/i);
    expect(sha(migration)).toBe("7f15a2abea185c506ddee69ea639d237a69d98f427eae215122038c7c5a3bf24");
  });
});
describe("frozen registration and delegation integrity migration", () => {
  it("closes NULL hash and grants no public canonical registration", () => {
    const sql = readFileSync("drizzle/0056_fuzzy_invaders.sql", "utf8");
    expect(sha(sql)).toBe("3b60191c7534898a00ba6edb84a81f2540d5ad0f8f01befce4f035027bcb25fc");
    expect(sql).toContain('"input_sha256" IS NOT NULL');
    expect(sql).toContain("SECURITY DEFINER SET search_path = pg_catalog");
    expect(sql).toContain("REVOKE ALL ON FUNCTION identity.register_canonical_user(text, text, text) FROM PUBLIC");
    expect(sql.lastIndexOf("identity.registration-integrity.v1")).toBeGreaterThan(sql.lastIndexOf("REVOKE ALL"));
    const fn = sql.slice(sql.indexOf("CREATE FUNCTION"), sql.indexOf("\n--> statement-breakpoint\nREVOKE"));
    expect(sha(fn)).toBe(registrationContract.registration_function_sha256);
    expect(registrationContract.runtime_delegations).toEqual(registrationSnapshot.tables["identity.runtime_delegations"]);
    const { contract_sha256: hash, ...value } = registrationContract;
    expect(sha(canonicalContractJson(value))).toBe(hash);
  });
});
describe("frozen runtime delegation expand migration", () => {
  it("matches all original ORM columns and the exact frozen expansion", () => {
    const config = getTableConfig(runtimeDelegations);
    const table = runtimeContract.tables["identity.runtime_delegations"];
    expect(table).toEqual(runtimeSnapshot.tables["identity.runtime_delegations"]);
    const originalColumns = config.columns.filter(column => column.name in table.columns);
    expect(originalColumns.map(column => column.name).sort()).toEqual(Object.keys(table.columns).sort());
    for (const column of originalColumns) {
      const expected = table.columns[column.name as keyof typeof table.columns];
      expect(column.getSQLType()).toBe(expected.type); expect(column.notNull).toBe(expected.notNull);
    }
    expect(sha(canonicalContractJson({ version: runtimeContract.version, tables: runtimeContract.tables }))).toBe(runtimeContract.contract_sha256);
    const expansion = readFileSync("drizzle/0055_unique_kitty_pryde.sql", "utf8");
    expect(sha(expansion)).toBe("559e9f406cf9ee64f7b8c5803cfb2a012dcfca7c21f5bcd4bf54e057a1d33351");
    expect(expansion.lastIndexOf("identity.runtime-delegation.v1")).toBeGreaterThan(expansion.lastIndexOf("ADD CONSTRAINT"));
    expect(expansion).not.toMatch(/DROP|TRUNCATE|UPDATE\s+"?users/i);
  });
});
describe("frozen purpose and Editor binding migration", () => {
  it("matches its original delegation columns and closes nullable purpose/array ambiguity", () => {
    const config = getTableConfig(runtimeDelegations), table = purposeContract.tables["identity.runtime_delegations"];
    const originalColumns = config.columns.filter(column => column.name in table.columns);
    expect(originalColumns).toHaveLength(18);
    expect(originalColumns.map(column => column.name).sort()).toEqual(Object.keys(table.columns).sort());
    for (const [key, value] of Object.entries(purposeContract.tables)) expect(value).toEqual(purposeSnapshot.tables[key as keyof typeof purposeSnapshot.tables]);
    for (const column of originalColumns) {
      const expected = table.columns[column.name as keyof typeof table.columns];
      expect(column.getSQLType()).toBe(expected.type); expect(column.notNull).toBe(expected.notNull);
    }
    expect(sha(canonicalContractJson({ version: purposeContract.version, tables: purposeContract.tables }))).toBe(purposeContract.contract_sha256);
    const expand = readFileSync("drizzle/0057_striped_justice.sql", "utf8"), validate = readFileSync("drizzle/0058_bouncy_captain_britain.sql", "utf8");
    expect(sha(expand)).toBe("97a2c151f26349c969297ba6d723ff0983c23ad76fa9d26028764723a229472f");
    expect(sha(validate)).toBe("529be612437591a82a570c15b608b0d2113b07cff3321fb1de0bbfa211a2524c");
    expect(expand).toContain('REFERENCES "public"."user_sessions"("id") ON DELETE cascade');
    expect(validate).toContain('"purpose" IS NOT NULL'); expect(validate).toContain('array_position("identity"."runtime_delegations"."scopes", NULL) IS NULL');
    expect(validate.lastIndexOf("identity.runtime-purpose.v1")).toBeGreaterThan(validate.lastIndexOf("ADD CONSTRAINT"));
  });
});
describe("confirmation claim delegation binding migration", () => {
  it("matches the current ORM, snapshot, capability hash and additive SQL", () => {
    const config = getTableConfig(runtimeDelegations);
    const table = confirmationClaimContract.tables["identity.runtime_delegations"];
    expect(config.columns).toHaveLength(21);
    expect(config.columns.map(column => column.name).sort()).toEqual(Object.keys(table.columns).sort());
    for (const [key, value] of Object.entries(confirmationClaimContract.tables)) {
      expect(value).toEqual(confirmationClaimSnapshot.tables[key as keyof typeof confirmationClaimSnapshot.tables]);
    }
    for (const column of config.columns) {
      const expected = table.columns[column.name as keyof typeof table.columns];
      expect(column.getSQLType()).toBe(expected.type); expect(column.notNull).toBe(expected.notNull);
    }
    const { contract_sha256: hash, ...value } = confirmationClaimContract;
    expect(sha(canonicalContractJson(value))).toBe(hash);
    const expansion = readFileSync("drizzle/0062_foamy_otto_octavius.sql", "utf8");
    expect(sha(expansion)).toBe("ef20e48432499a5565c2e3d42f24da8251c4651728e2e3fe7f2c9262123bb463");
    expect(expansion).toContain('REFERENCES "public"."chat_message"("id") ON DELETE cascade');
    expect(expansion.lastIndexOf("identity.runtime-confirmation-claim.v1"))
      .toBeGreaterThan(expansion.lastIndexOf("ADD CONSTRAINT"));
    expect(expansion).not.toMatch(/DROP|TRUNCATE|UPDATE\s+"?users/i);
  });
});
