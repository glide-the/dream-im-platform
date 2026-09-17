// [Input] Frozen Registry182 prefix, Registry183-184 DTOs, generated inventory and production POST route.
// [Output] Append-only hashes, background authority, schema requirements and dedicated dispatch evidence.
// [Pos] Registration gate for the shared Claude Plugin persistence aggregate.
// [Sync] 2026-09-16: append builtin reconciliation without changing Registry182 bytes.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./claudePluginDataHandler", () => ({
  isClaudePluginOperation: (value: string) => value.startsWith("claude-plugin."),
  handleClaudePluginOperation: mocks.handler,
}));
import generated191 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { claudePluginDataSchemaRequirements } from "./claudePluginDataService";
import { identitySchemaRequirement } from "./schemaRequirements";

const names = ["claude-plugin.installations.list", "claude-plugin.marketplace.list",
  "claude-plugin.install.prepare", "claude-plugin.operations.list", "claude-plugin.operation.read",
  "claude-plugin.installation.read", "claude-plugin.install.report", "claude-plugin.installation.uninstall",
  "claude-plugin.builtin.ensure", "claude-plugin.builtin.report"] as const;
const hashes = ["9795d0b9465050b0d9032be3b227a32a70a6a4fca50742e5921006d5b408deeb",
  "b7c05e5e460f36b5f8d8d03d3c595f405d58bf7f862f10e316b6e4b152cdd8bf",
  "02e01bdd5681e2f62eda62ea65e879f693fc72ebbf0f299fca47998e88601fad",
  "3a27f57269a9fb4da02526aaed41655850c53c264bcca49e669c76e6c37663ae",
  "edf3e075cb100ebe56ccd86703f80d08e9c7be952bca48e585484a29516b14b5",
  "690ae2a07b92258c11e36843cac1024f248aa8204410e39a4a2895bc07a8d620",
  "661e28352ec56257282f914091a6b33bc435d1dcdd4c1c7cf44482f2c16b7504",
  "904b5e2796ac17378facb4b3e8d2afb9e4e9cd72dc79a57dbd0cd74b3947d2a3",
  "74220704d8852909375ea70015af93b04bfb894e8e11a345ad2d8ef91539b5cf",
  "77d2c856d3712d4861caff95553db35676539768c82e58d5ab3a29a1dc916aea"];

beforeEach(() => vi.resetAllMocks());

it("preserves Registry182 and appends exactly Registry183-184", () => {
  expect(dreamOperations.length).toBeGreaterThanOrEqual(184);
  expect(generated191.slice(0, 184)).toEqual(dreamOperations.slice(0, 184));
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 174))).digest("hex"))
    .toBe("242ddb8e06c66058b4a6a0a015a08edb41353446ae00be46e6c2f1b946cf57dc");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 182))).digest("hex"))
    .toBe("aba16ed638cd1a88b0471208223efa2f13476c5c33ae2e01481ec559b9777fc1");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 184))).digest("hex"))
    .toBe("f71ac328ad7670298d518e388b2fde89033387f97ac35b91a0ea66da487b40cd");
  expect(dreamOperations.slice(174, 184).map(item => item.contract.name)).toEqual(names);
  expect(dreamOperations.slice(174, 184).map(item => item.capability.contract_sha256)).toEqual(hashes);
  for (const operation of dreamOperations.slice(174, 184)) {
    expect(operation.requirements).toEqual([identitySchemaRequirement, ...claudePluginDataSchemaRequirements]);
  }
  expect(dreamOperations.slice(174, 182).every(operation => operation.capability.background_scope === null)).toBe(true);
  expect(dreamOperations.slice(182, 184).map(operation => operation.capability.background_scope))
    .toEqual(["plugins:catalog", "plugins:catalog"]);
  expect(dreamOperations.slice(182, 184).map(operation => operation.capability.user_scope)).toEqual([null, null]);
});

it("dispatches Registry175-184 through the dedicated handler", async () => {
  const request = new Request("http://localhost/api/internal/dream/v1/operations/claude-plugin.install.prepare", { method: "POST" });
  const response = new Response("prepared"); mocks.handler.mockResolvedValue(response);
  expect(await POST(request, { params: Promise.resolve({ operation: "claude-plugin.install.prepare" }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, "claude-plugin.install.prepare");
});
