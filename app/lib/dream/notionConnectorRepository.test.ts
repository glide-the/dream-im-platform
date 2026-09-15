// [Input] Production Notion Repository source and five Admin Drizzle table mappings.
// [Output] ORM-only access and compound-write ownership invariants.
// [Pos] Static architecture fence; runtime behavior is covered by Service/Handler and isolated database gates.
// [Sync] 2026-09-16: prevent raw SQL/pool regressions or transaction splitting back into Dream.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("./notionConnectorRepository.ts", import.meta.url), "utf8");

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
