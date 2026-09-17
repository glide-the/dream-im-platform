// [Input] Registry106 DTO/service with fixed actor, policy and repository seams.
// [Output] Closed input/output, profile policy, scope and Thread binding evidence.
// [Pos] Provider-free workspace plugin metadata service test; ORM and filesystem stay separate.
// [Sync] 2026-09-15: verify standard profile needs no adapter config and Story profile fails closed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./deckWorkspacePluginsRepository", () => ({
  DeckWorkspacePluginsRepository: class {
    constructor(..._args: unknown[]) {}
    resolve = mocks.resolve;
  },
}));

import { runDeckWorkspacePluginsOperation } from "./deckWorkspacePluginsService";
import { deckWorkspacePluginsInputDto, deckWorkspacePluginsOutputDto } from "./deckWorkspacePluginsDto";
import type { DataTransaction } from "./database";

const tx = {} as DataTransaction;
const principal = {
  subject: "subject",
  canonical_user_id: "9007199254740993",
  client_id: "dream",
  scopes: ["dream:read"],
  status: "active" as const,
};
const actor = { principal, threadScope: null };
const standard = { thread_id: "thread-1", profile: "standard" as const };
const output = {
  thread_id: "thread-1",
  deck_id: "deck-1",
  refs: [{
    plugin_installation_id: "install-1",
    package_spec: "drama@official",
    package_name: "drama",
    marketplace: "official",
    resolved_version: "1.2.3",
    artifact_digest: `sha256:${"a".repeat(64)}`,
    installation_status: "ready" as const,
    order_index: 0,
  }],
  story_workspace_adapter: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue(output);
});
afterEach(() => vi.unstubAllEnvs());

describe("Registry106 DTO", () => {
  it.each(["actor_id", "user_id", "deck_id", "package_spec", "path", "sql", "table", "column"])(
    "rejects caller-authored %s",
    key => expect(deckWorkspacePluginsInputDto.safeParse({ ...standard, [key]: "caller" }).success).toBe(false),
  );

  it("requires explicit closed profile and rejects physical response fields", () => {
    expect(deckWorkspacePluginsInputDto.safeParse({ thread_id: "thread-1" }).success).toBe(false);
    expect(deckWorkspacePluginsInputDto.safeParse({ ...standard, profile: "custom" }).success).toBe(false);
    expect(deckWorkspacePluginsOutputDto.safeParse({ ...output, refs: [{ ...output.refs[0], artifact_path: "/tmp/x" }] }).success).toBe(false);
  });
});

describe("Registry106 service", () => {
  it("resolves standard metadata without requiring Story adapter configuration", async () => {
    expect(await runDeckWorkspacePluginsOperation("deck-workspace-plugins.resolve", standard, actor, tx)).toEqual(output);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(standard, null);
  });

  it("passes only the server-owned Story adapter policy", async () => {
    vi.stubEnv("DREAM_WORKSPACE_PLUGIN_POLICY_JSON", JSON.stringify({
      story_workspace_adapter: { package_name: "story", marketplace: "platform", resolved_version: null },
    }));
    const input = { ...standard, profile: "story_workspace" as const };
    await runDeckWorkspacePluginsOperation("deck-workspace-plugins.resolve", input, actor, tx);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(input, {
      story_workspace_adapter: { package_name: "story", marketplace: "platform", resolved_version: null },
    });
  });

  it("fails before ORM when Story adapter policy is missing", async () => {
    vi.stubEnv("DREAM_WORKSPACE_PLUGIN_POLICY_JSON", "");
    await expect(runDeckWorkspacePluginsOperation(
      "deck-workspace-plugins.resolve",
      { ...standard, profile: "story_workspace" },
      actor,
      tx,
    )).rejects.toMatchObject({ code: "WORKSPACE_PLUGIN_POLICY_NOT_CONFIGURED", status: 503 });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects missing scope, mismatched Thread grant and malformed stored data", async () => {
    await expect(runDeckWorkspacePluginsOperation("deck-workspace-plugins.resolve", standard, {
      principal: { ...principal, scopes: ["dream:write"] }, threadScope: null,
    }, tx)).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
    await expect(runDeckWorkspacePluginsOperation("deck-workspace-plugins.resolve", standard, {
      principal, threadScope: "thread-other",
    }, tx)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
    mocks.resolve.mockResolvedValueOnce({ ...output, thread_id: "thread-other" });
    await expect(runDeckWorkspacePluginsOperation("deck-workspace-plugins.resolve", standard, actor, tx)).rejects.toMatchObject({ code: "DECK_WORKSPACE_PLUGIN_DATA_INVALID", status: 503 });
  });

  it("accepts Repository tie ordering that is determined by unexposed created_at", async () => {
    const tied = [
      { ...output.refs[0], plugin_installation_id: "install-z", order_index: 0 },
      { ...output.refs[0], plugin_installation_id: "install-a", order_index: 0 },
    ];
    mocks.resolve.mockResolvedValueOnce({ ...output, refs: tied });
    expect((await runDeckWorkspacePluginsOperation(
      "deck-workspace-plugins.resolve", standard, actor, tx,
    )).refs).toEqual(tied);
  });
});
