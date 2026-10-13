// [Input] Original public operation/receipt routes with authenticated service and delegation boundaries.
// [Output] Exact capability, closed DTO and original absent/committed recovery evidence.
// [Pos] Provider-free public ingress regression; no parallel endpoint or real account mutation.
// [Sync] 2026-10-10: cover lexical receipt DTO scope and read/write authority before image dispatch.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), delegation: vi.fn(), transaction: vi.fn(), execute: vi.fn(), find: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/delegationService", () => ({ DelegationService: class { async resolve(...args: unknown[]) { return mocks.delegation(...args); } } }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { async find(...args: unknown[]) { return mocks.find(...args); } } }));
vi.mock("./imageTurnService", async original => ({ ...await original<typeof import("./imageTurnService")>(), executeImageTurnOperation: mocks.execute }));
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { AuthBoundaryError } from "../auth/config";
import { imageTurnReceiptKey } from "./imageTurnDto";
import { imageTurnSchemaRequirements } from "./imageTurnService";
const turnKey = "dream-turn-" + "a".repeat(64), key = imageTurnReceiptKey(turnKey), tx = { marker: "transaction" };
const authority = { serviceClientId: "service", principal: { subject: "subject", canonical_user_id: "102", scopes: ["dream:write"] },
  purpose: "server-persistence", threadId: "thread", runId: null, editorSessionId: null };
const binding = { thread_id: "thread", turn_id: "actual-turn", turn_key: turnKey, message_id: "message", ai_model: "ai", image_model: "image", materials: [], canonical_user_id: "102", run_id: null };
function receipt(query = "operation=image-turn.bind", token = "idg_original") {
  return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/${key}?${query}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: key }) });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockResolvedValue({ id: "service" });
  mocks.delegation.mockResolvedValue(authority); mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.find.mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());
it("public GET returns an absent original receipt without lexical initialization errors", async () => {
  const response = await receipt(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "absent", operation: "image-turn.bind", request_id: key }, request_id: key });
  expect(mocks.transaction.mock.calls[0]?.[0]).toEqual(imageTurnSchemaRequirements);
  expect(mocks.delegation).toHaveBeenCalledWith("idg_original", "dream:write", "service");
});
it("public GET returns only the committed result in the same entity", async () => {
  mocks.find.mockResolvedValue({ result: binding, threadScope: "thread", runScope: null, editorSessionScope: null });
  const response = await receipt(); expect(response.status).toBe(200); expect((await response.json()).data.result).toEqual(binding);
  mocks.find.mockResolvedValue({ result: binding, threadScope: "other", runScope: null, editorSessionScope: null });
  expect((await receipt()).status).toBe(503);
});
it("rejects browser identity, extra selectors, read-operation receipts and missing capability before lookup", async () => {
  expect((await receipt(undefined, "browser" )).status).toBe(403);
  expect((await receipt("operation=image-turn.bind&actor=caller")).status).toBe(404);
  expect((await receipt("operation=image-turn.result")).status).toBe(404);
  expect(mocks.find).not.toHaveBeenCalled();
  mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY")); expect((await receipt()).status).toBe(503);
});
it("public POST uses the named strict domain and rejects extra caller identity before transaction", async () => {
  const { canonical_user_id: ignored, run_id: ignoredRun, ...input } = binding; void ignored; void ignoredRun;
  const request = (value: unknown) => new Request("http://localhost/api/internal/dream/v1/operations/image-turn.bind", { method: "POST", headers: {
    authorization: "Bearer idg_original", "content-type": "application/json" }, body: JSON.stringify({ request_id: key, input: value }) });
  const call = (value: unknown) => POST(request(value), { params: Promise.resolve({ operation: "image-turn.bind" }) });
  mocks.execute.mockResolvedValue(binding); expect((await call(input)).status).toBe(200);
  expect(mocks.execute).toHaveBeenCalledWith(tx, authority, "image-turn.bind", key, input);
  mocks.transaction.mockClear(); expect((await call({ ...input, user_id: "caller" })).status).toBe(400); expect(mocks.transaction).not.toHaveBeenCalled();
});
