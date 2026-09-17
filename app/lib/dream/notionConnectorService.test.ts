// [Input] Notion connector DTOs, OAuth/delegated actor authority, background scope and mocked typed Repository.
// [Output] Closed command surface, actor derivation, scheduled-owner derivation and compound-operation dispatch evidence.
// [Pos] Provider-free domain contract test; PostgreSQL, Notion SDK and filesystem remain unavailable.
// [Sync] 2026-09-16: verify the complete Admin-owned Notion persistence boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  construct: vi.fn(), create: vi.fn(), list: vi.fn(), connector: vi.fn(), active: vi.fn(),
  patch: vi.fn(), delete: vi.fn(), requireConnector: vi.fn(), replaceResources: vi.fn(),
  listResources: vi.fn(), deleteResource: vi.fn(), saveSnapshot: vi.fn(), snapshot: vi.fn(),
  listSnapshots: vi.fn(), attachThread: vi.fn(), connectorForThread: vi.fn(), syncCandidates: vi.fn(),
}));
vi.mock("./notionConnectorRepository", () => ({
  NotionConnectorRepository: class {
    constructor(...args: unknown[]) { mocks.construct(...args); }
    create = mocks.create; list = mocks.list; connector = mocks.connector; active = mocks.active;
    patch = mocks.patch; delete = mocks.delete; requireConnector = mocks.requireConnector;
    replaceResources = mocks.replaceResources; listResources = mocks.listResources;
    deleteResource = mocks.deleteResource; saveSnapshot = mocks.saveSnapshot; snapshot = mocks.snapshot;
    listSnapshots = mocks.listSnapshots; attachThread = mocks.attachThread;
    connectorForThread = mocks.connectorForThread; syncCandidates = mocks.syncCandidates;
  },
}));

import type { DataTransaction } from "./database";
import { notionConnectorCreateInputDto, notionConnectorOperationContracts } from "./notionConnectorDto";
import { runNotionConnectorBackgroundOperation, runNotionConnectorUserOperation } from "./notionConnectorService";

const tx = { marker: "tx" } as unknown as DataTransaction;
const principal = {
  subject: "subject", canonical_user_id: "9007199254740993", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" as const,
};
const oauthActor = { principal, threadScope: null, runScope: null, delegationPurpose: null } as const;
const authority = { thread_id: "thread-1", workflow_run_id: `run_${"a".repeat(32)}` };
const delegatedActor = {
  principal, threadScope: authority.thread_id, runScope: authority.workflow_run_id,
  delegationPurpose: "server-persistence" as const,
};
const connectorId = "00000000-0000-4000-8000-000000000001";
const connector = {
  id: connectorId, user_id: principal.canonical_user_id, name: "Notion", platform: "notion",
  auth_status: "authenticated", config: {}, current_snapshot_version: null,
  current_source_revision: null, current_sync_cursor: null, last_synced_at: null,
  created_at: "2026-09-16T00:00:00.000Z", updated_at: "2026-09-16T00:00:00.000Z", sources: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(connector);
  mocks.list.mockResolvedValue([connector]);
  mocks.connector.mockResolvedValue(connector);
  mocks.syncCandidates.mockResolvedValue([connector]);
});

describe("Notion connector DTO", () => {
  it("registers only named business operations and separates user/background authority", () => {
    expect(Object.keys(notionConnectorOperationContracts)).toHaveLength(21);
    expect(Object.values(notionConnectorOperationContracts).filter(item => item.audience === "background"))
      .toHaveLength(5);
    expect(Object.values(notionConnectorOperationContracts).filter(item => item.audience === "background")
      .every(item => item.backgroundScope === "connectors:sync")).toBe(true);
  });

  it.each(["actor", "actor_id", "user_id", "sql", "table", "column", "transaction"])(
    "rejects caller-authored %s",
    key => expect(notionConnectorCreateInputDto.safeParse({
      authority: null, name: "Notion", platform: "notion", config: {}, [key]: "caller",
    }).success).toBe(false),
  );
});

describe("Notion connector service", () => {
  it("derives the canonical actor without converting bigint to number", async () => {
    await expect(runNotionConnectorUserOperation(
      "notion.connector.list", { authority: null }, oauthActor, tx,
    )).resolves.toEqual({ connectors: [connector] });
    expect(mocks.construct).toHaveBeenCalledExactlyOnceWith(tx, principal.canonical_user_id);
  });

  it("requires exact server-persistence Thread and Run authority", async () => {
    await expect(runNotionConnectorUserOperation(
      "notion.connector.get", { authority, connector_id: connectorId }, delegatedActor, tx,
    )).resolves.toEqual({ connector });
    await expect(runNotionConnectorUserOperation(
      "notion.connector.get",
      { authority: { ...authority, thread_id: "thread-other" }, connector_id: connectorId },
      delegatedActor, tx,
    )).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  });

  it("keeps resource replacement and snapshot save as one Repository command", async () => {
    mocks.replaceResources.mockResolvedValue(connector);
    await runNotionConnectorUserOperation("notion.resources.replace", {
      authority: null, connector_id: connectorId,
      databases: [{ external_id: "db-1", title: "DB", metadata: {} }], pages: [],
    }, oauthActor, tx);
    expect(mocks.replaceResources).toHaveBeenCalledTimes(1);
    const snapshot = {
      metadata: { workspace_id: "thread-1", resource_connector_id: connectorId, snapshot_version: "snap-1", source_revision: "rev-1", sync_cursor: "cursor-1", fetched_at: "2026-09-16T00:00:00.000Z", state: "snapshot_ready" },
      connector: {}, index: [], databases: [], database_pages: {}, pages: {},
    };
    mocks.saveSnapshot.mockResolvedValue(snapshot);
    await runNotionConnectorUserOperation("notion.snapshot.save", {
      authority: null, connector_id: connectorId, workspace_id: "thread-1",
      snapshot, synced_resources: [],
    }, oauthActor, tx);
    expect(mocks.saveSnapshot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      connector_id: connectorId, workspace_id: "thread-1", snapshot,
    }));
  });

  it("derives scheduled owner from connector ID and rejects missing scope", async () => {
    await expect(runNotionConnectorBackgroundOperation(
      "notion.sync-candidates.list", {}, { id: "dream", backgroundScopes: ["connectors:sync"] }, tx,
    )).resolves.toEqual({ connectors: [connector] });
    expect(mocks.construct).toHaveBeenLastCalledWith(tx, null);
    await expect(runNotionConnectorBackgroundOperation(
      "notion.sync-connector.get", { connector_id: connectorId }, { id: "dream", backgroundScopes: [] }, tx,
    )).rejects.toMatchObject({ code: "DREAM_SERVICE_SCOPE_REQUIRED", status: 403 });
  });
});
