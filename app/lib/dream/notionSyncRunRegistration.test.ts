// [Input] Frozen 221-operation prefix, four Notion execution descriptors and forward function/capability SQL.
// [Output] Exact DTO/hash/requirement and immutable migration registration evidence.
// [Pos] Source publication gate; isolated PostgreSQL verifies actual function permissions and transactions.
// [Sync] 2026-10-07: distinguish published operation contracts from claim rollout activation.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import contract from "../../../drizzle/contracts/dream-notion-sync-ownership-v1.json";
import inventory from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { notionSyncRunOperationContracts } from "./notionSyncRunDto";
import { isNotionConnectorOperation } from "./notionConnectorHandler";
import { notionSyncOwnershipRequirement } from "./notionConnectorService";

it("appends exactly four operations with strict scopes and exact capability", () => {
  expect(inventory).toEqual(dreamOperations);
  expect(dreamOperations.slice(-4).map(op=>op.contract.name)).toEqual(Object.keys(notionSyncRunOperationContracts));
  for (const descriptor of dreamOperations.slice(-4)) {
    expect(isNotionConnectorOperation(descriptor.contract.name)).toBe(true);
    expect(descriptor.requirements).toContainEqual(notionSyncOwnershipRequirement);
    expect(descriptor.capability.contract_sha256).toBe(createHash("sha256").update(canonicalContractJson(descriptor.contract)).digest("hex"));
    expect(descriptor.contract.input.additionalProperties).toBe(false);
  }
  expect(dreamOperations.at(-4)?.capability.user_scope).toBe("dream:write");
  expect(dreamOperations.slice(-3).every(op=>op.capability.background_scope==="connectors:sync")).toBe(true);
});
it("binds capability hash to the restricted function body and exact safe attributes", () => {
  const { contract_sha256, ...definition }=contract;
  expect(createHash("sha256").update(canonicalContractJson(definition)).digest("hex")).toBe(contract_sha256);
  const sql=readFileSync(new URL("../../../drizzle/0074_notion_sync_ownership.sql",import.meta.url),"utf8");
  const body=sql.split("AS $notion_actor$")[1].split("$notion_actor$;")[0].trim();
  expect(createHash("sha256").update(body).digest("hex")).toBe(contract.actor_lock.body_sha256);
  expect(sql).toContain(contract_sha256);
  expect(sql).toContain("SECURITY DEFINER VOLATILE PARALLEL UNSAFE");
  expect(sql).toContain("SET search_path = pg_catalog, pg_temp");
  expect(sql).toContain("FOR SHARE OF link, canonical, platform");
  expect(sql).toContain("REVOKE ALL ON FUNCTION identity.lock_active_notion_sync_actor(bigint, text) FROM PUBLIC");
});
