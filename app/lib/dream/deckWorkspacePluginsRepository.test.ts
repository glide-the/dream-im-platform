// [Input] Registry106 typed Repository with fixed runtime rows and captured Drizzle adapter query.
// [Output] Narrow projections, deterministic ready selection and standard-profile no-query evidence.
// [Pos] Provider-free ORM behavior test; restricted PostgreSQL remains an integration gate.
// [Sync] 2026-09-15: preserve enabled ref order and legacy installed/created/id adapter precedence.
import { describe, expect, it } from "vitest";
import { DeckWorkspacePluginsRepository } from "./deckWorkspacePluginsRepository";
import type { DataTransaction } from "./database";

const digest = `sha256:${"a".repeat(64)}`;
const runtimeRef = {
  plugin_installation_id: "deck-install", package_spec: "deck@market",
  package_name: "deck", marketplace: "market", resolved_version: "1.0.0",
  artifact_digest: digest, installation_status: "ready", order_index: 3,
};
const policy = { story_workspace_adapter: { package_name: "story", marketplace: "platform", resolved_version: null } };

function capturedTransaction(selections: Array<Array<Record<string, unknown>>>) {
  const calls: Array<{ projection: Record<string, unknown>; ordering: unknown[]; joins: number }> = [];
  let index = 0;
  const tx = {
    select(projection: Record<string, unknown>) {
      const rows = selections[index++] ?? [];
      const call = { projection, ordering: [] as unknown[], joins: 0 }; calls.push(call);
      const chain = {
        from() { return chain; }, where() { return chain; }, innerJoin() { call.joins += 1; return chain; },
        async limit() { return rows; },
        orderBy(...ordering: unknown[]) { call.ordering = ordering; return Promise.resolve(rows); },
      };
      return chain;
    },
  } as unknown as DataTransaction;
  return { tx, calls };
}

describe("Registry106 typed Repository", () => {
  it("returns only pack fields and performs no adapter query for standard profile", async () => {
    const { tx, calls } = capturedTransaction([
      [{ id: "thread-1", deck_id: "deck-1" }], [{ id: "deck-1" }], [runtimeRef],
    ]);
    const result = await new DeckWorkspacePluginsRepository(tx, "42").resolve(
      { thread_id: "thread-1", profile: "standard" },
      null,
    );
    expect(result).toEqual({
      thread_id: "thread-1", deck_id: "deck-1", story_workspace_adapter: null,
      refs: [{
        plugin_installation_id: "deck-install", package_spec: "deck@market", package_name: "deck",
        marketplace: "market", resolved_version: "1.0.0", artifact_digest: digest,
        installation_status: "ready", order_index: 3,
      }],
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.joins).toBe(1);
    expect(calls[2]?.ordering).toHaveLength(3);
  });

  it("returns latest status and the first ready adapter in stable query order", async () => {
    const { tx, calls } = capturedTransaction([
      [{ id: "thread-1", deck_id: "deck-1" }], [{ id: "deck-1" }], [runtimeRef], [
        { plugin_installation_id: "new-error", package_name: "story", marketplace: "platform", resolved_version: "2.0.0", artifact_digest: digest, installation_status: "error" },
        { plugin_installation_id: "ready", package_name: "story", marketplace: "platform", resolved_version: "1.0.0", artifact_digest: digest, installation_status: "ready" },
      ],
    ]);
    const result = await new DeckWorkspacePluginsRepository(tx, "42").resolve(
      { thread_id: "thread-1", profile: "story_workspace" },
      policy,
    );
    expect(result.story_workspace_adapter).toEqual({
      latest_status: "error",
      ready: {
        plugin_installation_id: "ready", package_spec: "story@platform", package_name: "story",
        marketplace: "platform", resolved_version: "1.0.0", artifact_digest: digest,
        installation_status: "ready",
      },
    });
    expect(calls).toHaveLength(4);
    expect(Object.keys(calls[3]?.projection ?? {})).toEqual([
      "plugin_installation_id", "package_name", "marketplace", "resolved_version",
      "artifact_digest", "installation_status",
    ]);
    expect(calls[3]?.ordering).toHaveLength(3);
  });

  it("does not resolve an adapter for an unbound Thread", async () => {
    const { tx, calls } = capturedTransaction([[{ id: "thread-1", deck_id: null }]]);
    expect(await new DeckWorkspacePluginsRepository(tx, "42").resolve(
      { thread_id: "thread-1", profile: "story_workspace" }, policy,
    )).toEqual({ thread_id: "thread-1", deck_id: null, refs: [], story_workspace_adapter: null });
    expect(calls).toHaveLength(1);
  });
});
