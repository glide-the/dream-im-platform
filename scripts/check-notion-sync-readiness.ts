// [Input] Explicit PostgreSQL DATA credential, expected database identity and server execution configuration.
// [Output] Read-only exact capability/function/config/claim-gate readiness receipt, without DSN or credentials.
// [Pos] Release preflight; does not migrate, enable claims or infer legacy writer drain.
// [Sync] 2026-10-07: separate installed capability, physical actor-lock validity and default-closed claim readiness.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { notionSyncExecutionPolicy, requireNotionSyncClaimsEnabled } from "../config/notion-sync-policy";
import { withDataTransaction } from "../app/lib/dream/database";
import { notionOperationSchemaRequirements } from "../app/lib/dream/notionConnectorService";
import { identitySchemaRequirement } from "../app/lib/dream/schemaRequirements";
import { assertNotionSyncOwnershipSchema } from "../app/lib/dream/notionSyncRunSchema";
import contract from "../drizzle/contracts/dream-notion-sync-ownership-v1.json";
const url=process.env.DREAM_DATA_DATABASE_URL;
const expected=process.env.EXPECTED_DATABASE_NAME;
if (!url || !expected) throw Error("Explicit DATA URL and expected database name required");
const pool=new Pool({connectionString:url,max:1});
try {
  const identity=(await pool.query("SELECT current_database() AS name")).rows[0];
  if(identity.name!==expected) throw Error("Expected database identity mismatch");
  await withDataTransaction([identitySchemaRequirement,...notionOperationSchemaRequirements("notion.sync-run.claim")],assertNotionSyncOwnershipSchema,drizzle(pool));
  const policy=notionSyncExecutionPolicy();requireNotionSyncClaimsEnabled();
  console.log(JSON.stringify({database:expected,capability:contract.capability,version:1,contract_sha256:contract.contract_sha256,actor_lock:"ready",execution_policy:policy,claim_gate:"enabled",legacy_drain:"requires independent release evidence",read_only:true}));
} catch(error) {
  const code=error && typeof error==="object" && "code" in error ? String(error.code):"NOTION_SYNC_READINESS_FAILED";
  console.log(JSON.stringify({database:expected,ready:false,code,read_only:true}));process.exitCode=2;
} finally {await pool.end();}
