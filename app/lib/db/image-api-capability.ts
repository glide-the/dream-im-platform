// [Input] PostgreSQL schema capability row and the server-owned Image API contract identity.
// [Output] Exact read-only availability predicate for Image Gateway and Admin projections.
// [Pos] Database contract gate; it never creates or migrates schema at runtime.
// [Sync] 2026-10-09: add gateway.images.v1 version/hash verification.

import type { PoolClient } from "pg";

import { imageApiPolicy } from "../../../config/image-api-policy";

export async function imageApiCapabilityAvailable(client: PoolClient) {
  const required = imageApiPolicy.schemaCapability;
  const result = await client.query<{
    version: number;
    contract_sha256: string;
  }>(
    `SELECT version, contract_sha256
       FROM drizzle.schema_capabilities
      WHERE capability = $1`,
    [required.capability],
  );
  const row = result.rows[0];
  return row?.version === required.version
    && row.contract_sha256 === required.contractSha256;
}
