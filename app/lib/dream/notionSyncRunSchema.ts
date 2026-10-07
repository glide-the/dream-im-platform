// [Input] Exact Notion capability plus PostgreSQL function attributes and current DATA privileges.
// [Output] Fail-closed actor-lock implementation validation before execution or receipt recovery.
// [Pos] Admin physical contract check; capability registration alone does not enable claims.
// [Sync] 2026-10-07: detect missing/replaced/unsafe functions and missing EXECUTE without runtime DDL.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import contract from "../../../drizzle/contracts/dream-notion-sync-ownership-v1.json";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
export async function assertNotionSyncOwnershipSchema(tx: DataTransaction) {
  const result = await tx.execute(sql`SELECT p.prosrc AS body, p.prosecdef AS definer, p.provolatile AS volatility,
    p.proparallel AS parallel, p.proconfig AS config, p.prorettype::regtype::text AS result_type,
    l.lanname AS language, p.proowner::regrole::text AS owner, n.nspowner::regrole::text AS schema_owner, current_user AS executor,
    NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      WHERE a.privilege_type = 'EXECUTE' AND (a.grantee NOT IN (p.proowner, current_user::regrole::oid)
        OR (a.grantee = current_user::regrole::oid AND a.is_grantable))) AS exact_acl,
    has_function_privilege(current_user, p.oid, 'EXECUTE') AS executable
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'identity' AND p.proname = 'lock_active_notion_sync_actor'
      AND p.proargtypes = '20 25'::oidvector`);
  const row = result.rows[0] as { body: string; definer: boolean; volatility: string; parallel: string; config: string[]; result_type: string; language: string; owner: string; schema_owner: string; executor: string; exact_acl: boolean; executable: boolean } | undefined;
  if (!row || !row.definer || row.volatility !== "v" || row.parallel !== "u" || row.language !== "plpgsql"
    || row.result_type !== "boolean" || row.owner === row.executor || row.owner !== row.schema_owner || !row.exact_acl || !row.executable
    || JSON.stringify(row.config) !== JSON.stringify(["search_path=pg_catalog, pg_temp"])
    || createHash("sha256").update(row.body.trim()).digest("hex") !== contract.actor_lock.body_sha256)
    throw new AuthBoundaryError("NOTION_SYNC_CAPABILITY_UNAVAILABLE", 503);
}
