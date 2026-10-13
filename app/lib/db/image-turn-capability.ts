// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] The original Gateway transaction client and the Admin-published image-turn contract.
// [Output] Exact capability and separate current-role privilege checks; unavailable configurations fail closed.
// [Pos] Read-only boundary; schema publication never implies that a different role has Gateway permissions.
// [Sync] 2026-10-10: gate image-turn receipts without new roles, grants, runtime DDL or a second connection.
import type { PoolClient } from "pg";
import contract from "../../../drizzle/contracts/dream-image-turn-v1.json";
export const imageTurnSchemaRequirement = {
  capability: contract.capability, version: contract.version, contractSha256: contract.contract_sha256,
} as const;
export async function imageTurnCapabilityAvailable(client: PoolClient) {
  const result = await client.query<{ version: number; contract_sha256: string; can_use_schema: boolean;
    can_read: boolean; can_append: boolean; can_audit: boolean }>(
    `SELECT version, contract_sha256,
       has_schema_privilege(current_user, 'dream', 'USAGE') AS can_use_schema,
       CASE WHEN has_schema_privilege(current_user, 'dream', 'USAGE')
         THEN has_table_privilege(current_user, 'dream.operation_receipts', 'SELECT') ELSE false END AS can_read,
       CASE WHEN has_schema_privilege(current_user, 'dream', 'USAGE')
         THEN has_table_privilege(current_user, 'dream.operation_receipts', 'INSERT') ELSE false END AS can_append,
       CASE WHEN has_schema_privilege(current_user, 'public', 'USAGE')
         THEN has_table_privilege(current_user, 'public.admin_audit_logs', 'INSERT') ELSE false END AS can_audit
     FROM drizzle.schema_capabilities WHERE capability = $1`, [imageTurnSchemaRequirement.capability]);
  const row = result.rows[0];
  return row?.version === imageTurnSchemaRequirement.version && row.contract_sha256 === imageTurnSchemaRequirement.contractSha256
    && row.can_use_schema === true && row.can_read === true && row.can_append === true && row.can_audit === true;
}
