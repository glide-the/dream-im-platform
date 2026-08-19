// [Input] Checked Dream physical table set and a read-only PostgreSQL catalog connection.
// [Output] Canonical physical catalog/count/hash receipt for migration adoption and drift validation.
// [Pos] Shared schema-contract capture used by cutover generation and disposable PostgreSQL E2E.
// [Sync] 2026-08-19: include Deck draft revision and ClaudePlugin Marketplace lineage columns/indexes in physical counts.

import { createHash } from "node:crypto";

export const DREAM_SCHEMA_CONTRACT_FORMAT = "ink-admin-dream-schema-contract-v1";
export const DREAM_CORE_COUNTS = Object.freeze({
  tables: 48,
  columns: 569,
  explicitIndexes: 82,
  triggers: 25,
});
export const DREAM_PHYSICAL_COUNTS = Object.freeze({
  tables: 48,
  columns: 589,
  explicitIndexes: 87,
  triggers: 28,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertTableNames(tableNames) {
  if (
    !Array.isArray(tableNames)
    || tableNames.length !== DREAM_PHYSICAL_COUNTS.tables
    || new Set(tableNames).size !== tableNames.length
    || tableNames.some((name) => !/^[a-z][a-z0-9_]*$/.test(name))
  ) {
    throw new Error("DREAM_SCHEMA_TABLE_SET_INVALID");
  }
}

export async function captureDreamSchemaContract(client, tableNames) {
  assertTableNames(tableNames);
  const result = await client.query(`
    WITH selected_tables AS (
      SELECT c.oid, c.relname AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public'
         AND c.relkind IN ('r','p')
         AND c.relname=ANY($1::text[])
    ), table_contracts AS (
      SELECT st.table_name,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ordinal', a.attnum,
            'name', a.attname,
            'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'notNull', a.attnotnull,
            'identity', nullif(a.attidentity, ''),
            'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true)
          ) ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a
          LEFT JOIN pg_catalog.pg_attrdef ad
            ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
          WHERE a.attrelid=st.oid AND a.attnum>0 AND NOT a.attisdropped
        ), '[]'::jsonb) AS columns,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', con.conname,
            'type', con.contype,
            'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
            'validated', con.convalidated
          ) ORDER BY con.contype, con.conname)
          FROM pg_catalog.pg_constraint con
          WHERE con.conrelid=st.oid AND con.contype IN ('p','u','c','f')
        ), '[]'::jsonb) AS constraints,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', ic.relname,
            'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
            'valid', i.indisvalid
          ) ORDER BY ic.relname)
          FROM pg_catalog.pg_index i
          JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
          LEFT JOIN pg_catalog.pg_constraint con ON con.conindid=i.indexrelid
          WHERE i.indrelid=st.oid AND con.oid IS NULL
        ), '[]'::jsonb) AS indexes,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', tg.tgname,
            'definition', pg_catalog.pg_get_triggerdef(tg.oid, true),
            'function', pg_catalog.pg_get_functiondef(proc.oid)
          ) ORDER BY tg.tgname)
          FROM pg_catalog.pg_trigger tg
          JOIN pg_catalog.pg_proc proc ON proc.oid=tg.tgfoid
          WHERE tg.tgrelid=st.oid AND NOT tg.tgisinternal
        ), '[]'::jsonb) AS triggers
      FROM selected_tables st
    )
    SELECT jsonb_build_object(
      'tables', COALESCE(jsonb_agg(jsonb_build_object(
        'name', table_name,
        'columns', columns,
        'constraints', constraints,
        'indexes', indexes,
        'triggers', triggers
      ) ORDER BY table_name), '[]'::jsonb)
    ) AS catalog
    FROM table_contracts
  `, [tableNames]);
  const catalog = result.rows[0]?.catalog;
  const tables = catalog?.tables;
  if (!Array.isArray(tables) || tables.length !== tableNames.length) {
    throw new Error("DREAM_SCHEMA_TABLE_SET_INCOMPLETE");
  }
  const counts = {
    tables: tables.length,
    columns: tables.reduce((sum, table) => sum + table.columns.length, 0),
    explicitIndexes: tables.reduce((sum, table) => sum + table.indexes.length, 0),
    triggers: tables.reduce((sum, table) => sum + table.triggers.length, 0),
  };
  if (canonicalJson(counts) !== canonicalJson(DREAM_PHYSICAL_COUNTS)) {
    throw new Error(`DREAM_SCHEMA_PHYSICAL_COUNTS_MISMATCH: ${canonicalJson(counts)}`);
  }
  const payload = {
    format: DREAM_SCHEMA_CONTRACT_FORMAT,
    dreamCoreCounts: DREAM_CORE_COUNTS,
    physicalCounts: counts,
    tableNames: [...tableNames].sort(),
    catalog,
  };
  return {
    ...payload,
    catalogSha256: createHash("sha256").update(canonicalJson(catalog)).digest("hex"),
    contractSha256: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  };
}

export function contractTableSubset(contract, names) {
  const selected = new Set(names);
  return {
    tables: contract.catalog.tables.filter((table) => selected.has(table.name)),
  };
}

export function canonicalDreamSchemaJson(value) {
  return canonicalJson(value);
}
