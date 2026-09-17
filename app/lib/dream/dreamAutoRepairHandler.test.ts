// [Input] Registry169 HTTP envelope, service identity and OAuth or exact turn grant.
// [Output] Body limit, capability requirements, actor binding and strict selector rejection.
// [Pos] Provider-free Admin ingress test.
// [Sync] 2026-09-16: validate the auto-repair operation boundary.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./dreamAutoRepairService", async original => ({
  ...await original<typeof import("./dreamAutoRepairService")>(), runDreamAutoRepairOperation: mocks.run,
}));
import { handleDreamAutoRepair } from "./dreamAutoRepairHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamAutoRepairSchemaRequirements } from "./dreamAutoRepairService";
const input = { thread_id: "thread-1", message_id: "dream_repair_1", status: "dispatched", expected_identity: {
  kind: "story-workspace-dream-auto-repair", schema_version: "story-workspace-dream-auto-repair/v1",
  originating_message_id: "origin", originating_turn_id: "turn", workflow_run_id: `run_${"a".repeat(32)}`,
  repair_attempt: 1, validation_code: "DREAM_STAGE_SCHEMA_INVALID",
  idempotency_key: `dream-auto-repair/v1:${"b".repeat(64)}`, project_cleanup: null,
} };
const output = { message_id: input.message_id, status: "dispatched", changed: true };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:write"], status: "active" }, threadScope: "thread-1", runScope: input.expected_identity.workflow_run_id };
function request(raw: unknown, token = "idg_grant") { return new Request("http://localhost/api/internal/dream/v1/operations/dream-auto-repair.settle", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ request_id: "auto-repair-original", input: raw }),
}); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" }); mocks.actor.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.run.mockResolvedValue(output); });
afterEach(() => vi.unstubAllEnvs());

it.each(["oauth", "idg_grant"])("binds %s to the exact Thread", async token => {
  const response = await handleDreamAutoRepair(request(input, token), "dream-auto-repair.settle");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "auto-repair-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([
    identitySchemaRequirement, ...dreamAutoRepairSchemaRequirements,
    ...(token.startsWith("idg_") ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
  ]);
  expect(mocks.actor).toHaveBeenCalledWith({ marker: "tx" }, expect.any(Headers), { id: "dream-service" }, "dream:write", "thread-1", undefined, "dream-auto-repair.settle");
});

it("rejects caller authority and database selectors before a transaction", async () => {
  for (const key of ["actor_id", "user_id", "role", "table", "column", "sql", "transaction"])
    expect((await handleDreamAutoRepair(request({ ...input, [key]: "caller" }), "dream-auto-repair.settle")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
