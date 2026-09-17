// [Input] Frozen Registry184 prefix, Registry185-191 DTOs, generated inventory and production route.
// [Output] Append-only hashes, exact scopes/schema requirements and dedicated dispatch evidence.
// [Pos] Registration gate for the final Story Workspace database cutover aggregate.
// [Sync] 2026-09-16: register seven DTO-Service-Drizzle Artifact operations.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceArtifactHandler", () => ({
  isStoryWorkspaceArtifactOperation: (value: string) => value.startsWith("story-workspace-artifact."),
  handleStoryWorkspaceArtifact: mocks.handler,
}));
import generated191 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceArtifactSchemaRequirements } from "./storyWorkspaceArtifactService";

const names = ["story-workspace-artifact.runs", "story-workspace-artifact.authority",
  "story-workspace-artifact.episode-authority.ensure", "story-workspace-artifact.output-ready",
  "story-workspace-artifact.index.inspect", "story-workspace-artifact.index.materialize",
  "story-workspace-artifact.index.reconcile"] as const;
const hashes = ["4a6d51e9768000a843c8a2fce68f4c98556368c05f504f5160786bfd3cff22dd",
  "2c7aa9af8fe8ea40c04a4065370ac77233911889a3d8658d4d7f7009e36732be",
  "344f0c181d785370f3b98a6755d20fff3005db4bc46008640a5ddcad149dd792",
  "dc56799f1c487f5a1e37b59d9369803558baedc3c015829abb7661133876d6fa",
  "514c48c5790736a94893712d5ed0c44795ee46cce8061ad3f531a842bf9b46e1",
  "555f6c9fad6dd659b5da6ae855325ef2af81edf6a21224bd3a1b2cd8c1b18a8a",
  "18dda46efa34060fbaf01b665cfd0f43a4ea6805295847b5d5f48acde79f08dc"];

beforeEach(() => vi.resetAllMocks());

it("preserves Registry184 and appends exactly Registry185-191", () => {
  expect(dreamOperations).toHaveLength(191);
  expect(generated191).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 184))).digest("hex"))
    .toBe("f71ac328ad7670298d518e388b2fde89033387f97ac35b91a0ea66da487b40cd");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex"))
    .toBe("508731c75d4db117d587566f16cab423bd9dc41528a2b60599106623d61e2d58");
  expect(dreamOperations.slice(184).map(item => item.contract.name)).toEqual(names);
  expect(dreamOperations.slice(184).map(item => item.capability.contract_sha256)).toEqual(hashes);
  expect(dreamOperations.slice(184).map(item => item.capability.kind))
    .toEqual(["read", "read", "write", "write", "read", "write", "write"]);
  expect(dreamOperations.slice(184).map(item => item.capability.user_scope))
    .toEqual(["dream:read", "dream:read", "dream:write", "dream:write", "dream:read", "dream:write", "dream:write"]);
  for (const operation of dreamOperations.slice(184)) {
    expect(operation.requirements).toEqual([identitySchemaRequirement, ...storyWorkspaceArtifactSchemaRequirements]);
  }
});

it("dispatches Registry185-191 through the dedicated handler", async () => {
  const request = new Request("http://localhost/api/internal/dream/v1/operations/story-workspace-artifact.index.inspect", { method: "POST" });
  const response = new Response("inspected"); mocks.handler.mockResolvedValue(response);
  expect(await POST(request, { params: Promise.resolve({ operation: "story-workspace-artifact.index.inspect" }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, "story-workspace-artifact.index.inspect");
});
