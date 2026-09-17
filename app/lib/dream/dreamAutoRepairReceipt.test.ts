// [Input] Registry169 original request ID and exact delegated Thread/Run authority.
// [Output] Committed/absent receipt evidence without reissuing settlement.
// [Pos] Provider-free unknown-COMMIT recovery test.
// [Sync] 2026-09-16: bind recovery to the original turn grant and strict output.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), transaction: vi.fn(), find: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { find = mocks.find; } }));
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamAutoRepairSchemaRequirements } from "./dreamAutoRepairService";

const runId = `run_${"a".repeat(32)}`;
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:write"], status: "active" }, threadScope: "thread-1", runScope: runId, editorSessionScope: null };
const result = { message_id: "dream_repair_1", status: "dispatched", changed: true };
const receipt = { inputSha256: "b".repeat(64), result, threadScope: "thread-1", runScope: runId, editorSessionScope: null };
function read() { return GET(new Request("http://localhost/api/internal/dream/v1/receipts/auto-repair-original?operation=dream-auto-repair.settle", {
  headers: { authorization: "Bearer idg_grant" },
}), { params: Promise.resolve({ requestId: "auto-repair-original" }) }); }
beforeEach(() => { vi.resetAllMocks(); mocks.service.mockReturnValue({ id: "dream-service" }); mocks.actor.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.find.mockResolvedValue(receipt); });

it("returns the strict original result under the same delegated authority", async () => {
  const response = await read();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "committed", operation: "dream-auto-repair.settle", request_id: "auto-repair-original", result }, request_id: "auto-repair-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...dreamAutoRepairSchemaRequirements,
    runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith("dream-auto-repair.settle", "auto-repair-original");
});

it("returns absence and rejects a mismatched stored Run scope", async () => {
  mocks.find.mockResolvedValue(null);
  expect(await (await read()).json()).toMatchObject({ data: { status: "absent" } });
  mocks.find.mockResolvedValue({ ...receipt, runScope: `run_${"c".repeat(32)}` });
  const denied = await read(); expect(denied.status).toBe(403);
});
