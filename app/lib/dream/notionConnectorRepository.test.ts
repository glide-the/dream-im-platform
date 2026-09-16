// [Input] Production Notion Repository source, typed Drizzle rows and five Admin table mappings.
// [Output] ORM-only ownership plus exact storage-row to strict DTO projection coverage.
// [Pos] Provider-free Repository contract gate; Service/Handler and isolated database gates cover higher layers.
// [Sync] 2026-09-17: prove storage-only JSON columns are decoded and excluded from strict response DTOs.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { DataTransaction } from "./database";
import { NotionConnectorRepository } from "./notionConnectorRepository";

const source = readFileSync(new URL("./notionConnectorRepository.ts", import.meta.url), "utf8");

const connectorId = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const storedTime = "2026-09-17 10:20:30+08";

function queuedTransaction(...resultSets: Record<string, unknown>[][]): DataTransaction {
  const queued = [...resultSets];
  return {
    select() {
      const rows = queued.shift();
      if (!rows) throw new Error("Unexpected Repository select");
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        for: () => query,
        then<TResult1 = Record<string, unknown>[], TResult2 = never>(
          resolve?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
          reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as DataTransaction;
}

const connectorRow = {
  id: connectorId,
  user_id: "9007199254740993",
  name: "Notion",
  platform: "notion",
  auth_status: "authenticated",
  config_json: '{"workspace":"dream"}',
  current_snapshot_version: "snapshot-v1",
  current_source_revision: "source-v1",
  current_sync_cursor: "cursor-v1",
  last_synced_at: storedTime,
  created_at: storedTime,
  updated_at: storedTime,
};

const resourceRow = {
  id: resourceId,
  connector_id: connectorId,
  resource_type: "notion_database",
  external_id: "database-1",
  title: "Stories",
  metadata_json: '{"icon":"book"}',
  sync_status: "synced",
  created_at: storedTime,
  updated_at: storedTime,
};

const snapshot = {
  metadata: {
    workspace_id: "workspace-1",
    resource_connector_id: connectorId,
    snapshot_version: "snapshot-v1",
    source_revision: "source-v1",
    sync_cursor: "cursor-v1",
    fetched_at: "2026-09-17T02:20:30Z",
    state: "snapshot_ready",
  },
  connector: {}, index: {}, databases: {}, database_pages: {}, pages: {},
};

it("uses the five typed Drizzle tables without raw query execution or connection ownership", () => {
  for (const table of [
    "resource_connectors", "connector_resources", "connector_resource_pages",
    "connector_snapshots", "connector_chat_threads",
  ]) expect(source).toContain(table);
  expect(source).not.toMatch(/\.execute\s*\(/);
  expect(source).not.toMatch(/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+resource_|DELETE\s+FROM)\b/);
  expect(source).not.toMatch(/\b(?:Pool|Client|psycopg|DATABASE_URL)\b/);
});

it("keeps resource replacement in one Repository command", () => {
  const body = source.slice(source.indexOf("async replaceResources"), source.indexOf("async deleteResource"));
  expect(body).toContain("requireConnector(connectorId, { lock: true })");
  expect(body).toContain("this.tx.delete(resources)");
  expect(body).toContain("insertResource(connectorId");
  expect(body).toContain("this.tx.update(connectors)");
});

it("keeps snapshot, page, resource-status and connector-current writes in one Repository command", () => {
  const body = source.slice(source.indexOf("async saveSnapshot"), source.indexOf("async attachThread"));
  expect(body).toContain("requireConnector(input.connector_id, { lock: true, background })");
  expect(body).toContain("this.tx.insert(snapshots)");
  expect(body).toContain("this.tx.delete(resourcePages)");
  expect(body).toContain("this.tx.update(resources)");
  expect(body).toContain("this.tx.update(connectors)");
});

it("projects connector and resource storage rows into exact strict DTOs", async () => {
  const repository = new NotionConnectorRepository(queuedTransaction([connectorRow], [resourceRow]), null);
  const [connector] = await repository.syncCandidates();

  expect(connector).toEqual({
    id: connectorId,
    user_id: "9007199254740993",
    name: "Notion",
    platform: "notion",
    auth_status: "authenticated",
    config: { workspace: "dream" },
    current_snapshot_version: "snapshot-v1",
    current_source_revision: "source-v1",
    current_sync_cursor: "cursor-v1",
    last_synced_at: "2026-09-17T10:20:30+08:00",
    created_at: "2026-09-17T10:20:30+08:00",
    updated_at: "2026-09-17T10:20:30+08:00",
    sources: [{
      id: resourceId,
      connector_id: connectorId,
      resource_type: "notion_database",
      external_id: "database-1",
      title: "Stories",
      metadata: { icon: "book" },
      sync_status: "synced",
      created_at: "2026-09-17T10:20:30+08:00",
      updated_at: "2026-09-17T10:20:30+08:00",
    }],
  });
  expect(connector).not.toHaveProperty("config_json");
  expect(connector.sources[0]).not.toHaveProperty("metadata_json");
});

it("projects snapshot storage JSON into the exact strict snapshot record DTO", async () => {
  const snapshotRow = {
    id: snapshotId,
    connector_id: connectorId,
    snapshot_version: "snapshot-v1",
    source_revision: "source-v1",
    sync_cursor: "cursor-v1",
    fetched_at: storedTime,
    state: "snapshot_ready",
    snapshot_json: JSON.stringify(snapshot),
    created_at: storedTime,
    updated_at: storedTime,
  };
  const repository = new NotionConnectorRepository(
    queuedTransaction([connectorRow], [resourceRow], [snapshotRow]),
    "9007199254740993",
  );

  const [record] = await repository.listSnapshots(connectorId);
  expect(record.snapshot).toEqual(snapshot);
  expect(record).not.toHaveProperty("snapshot_json");
  expect(record).toMatchObject({
    id: snapshotId,
    connector_id: connectorId,
    fetched_at: "2026-09-17T10:20:30+08:00",
    created_at: "2026-09-17T10:20:30+08:00",
    updated_at: "2026-09-17T10:20:30+08:00",
  });
});
