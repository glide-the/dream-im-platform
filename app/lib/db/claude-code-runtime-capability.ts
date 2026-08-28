// [Input] A PostgreSQL client and the versioned Claude Code Runtime capability policy.
// [Output] A read-only exact capability predicate shared by Admin model APIs and Gateway catalog reads.
// [Pos] Database contract helper; callers own domain-specific fail-closed errors and never run DDL.
// [Sync] 2026-08-28: add dream.claude-code-runtime-config.v1 exact version/hash verification.

import type { PoolClient } from "pg";
import { claudeAgentResourcePolicy } from "../../../config/claude-agent-resource-policy";

type CapabilityRow = { version: number; contract_sha256: string };

export async function claudeCodeRuntimeCapabilityAvailable(client: PoolClient) {
  const capability = claudeAgentResourcePolicy.claudeCodeRuntime;
  const result = await client.query<CapabilityRow>(
    `SELECT version, contract_sha256
       FROM drizzle.schema_capabilities
      WHERE capability = $1`,
    [capability.capability],
  );
  const row = result.rows[0];
  return row?.version === capability.version
    && row.contract_sha256 === capability.contractSha256;
}
