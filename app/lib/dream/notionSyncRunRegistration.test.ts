// [Input] Frozen 221-operation prefix, four Notion execution descriptors and forward function/capability SQL.
// [Output] Exact DTO/hash/requirement and immutable migration registration evidence.
// [Pos] Source publication gate; isolated PostgreSQL verifies actual function permissions and transactions.
// [Sync] 2026-10-07: distinguish published operation contracts from claim rollout activation.
// [Sync] 2026-10-07: locate the exact contiguous Notion group by operation name, preserving all checks when later domains extend the registry.
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
  const names = Object.keys(notionSyncRunOperationContracts);
  const registered = dreamOperations.filter(op => names.includes(op.contract.name));
  expect(registered.map(op => op.contract.name)).toEqual(names);
  const start = dreamOperations.findIndex(op => op.contract.name === names[0]);
  expect(dreamOperations.slice(start, start + names.length)).toEqual(registered);
  for (const descriptor of registered) {
    expect(isNotionConnectorOperation(descriptor.contract.name)).toBe(true);
    expect(descriptor.requirements).toContainEqual(notionSyncOwnershipRequirement);
    expect(descriptor.capability.contract_sha256).toBe(createHash("sha256").update(canonicalContractJson(descriptor.contract)).digest("hex"));
    expect(descriptor.contract.input.additionalProperties).toBe(false);
  }
  expect(registered[0]?.capability.user_scope).toBe("dream:write");
  expect(registered.slice(1).every(op=>op.capability.background_scope==="connectors:sync")).toBe(true);
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
