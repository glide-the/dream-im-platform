import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminError } from "./errors";
import { handleGatewayPayloadDetail } from "./gateway-payloads";

const mocks = vi.hoisted(() => ({ require: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("./guard", async (importOriginal) => ({ ...(await importOriginal<typeof import("./guard")>()), requireAdminRequest: mocks.require, adminRequestId: () => "admin_req" }));
vi.mock("./audit", () => ({ recordAdminAuditOnClient: mocks.audit }));
vi.mock("../platform-db", () => ({ withPlatformTransaction: mocks.transaction }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue({ id: "admin_1", permissions: ["gateway.payloads.read"] });
  mocks.audit.mockResolvedValue(undefined);
});

describe("full gateway payload access", () => {
  it("requires the independent permission and explicit reveal confirmation", async () => {
    const response = await handleGatewayPayloadDetail(new Request("http://localhost/api/admin/gateway-requests/req_1/payload"), "req_1");
    expect(response.status).toBe(428);
    expect(mocks.require).toHaveBeenCalledWith(expect.any(Request), "gateway.payloads.read");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns ordered reconstructable SSE and writes content-free immutable audit metadata", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "req_1", requested_model: "alias" }] })
      .mockResolvedValueOnce({ rows: [{ headers: { authorization: "[REDACTED]" }, body_text: '{"prompt":"secret-content"}' }] })
      .mockResolvedValueOnce({ rows: [{ completion_status: "complete" }] })
      .mockResolvedValueOnce({ rows: [{ sequence: 0, raw_event: "data: one\n\n" }, { sequence: 1, raw_event: "data: two\n\n" }], rowCount: 2 });
    mocks.transaction.mockImplementation(async (callback: (client: { query: typeof query }) => Promise<unknown>) => await callback({ query }));
    const response = await handleGatewayPayloadDetail(new Request("http://localhost/api/admin/gateway-requests/req_1/payload", { headers: { "x-gateway-payload-confirmation": "reveal" } }), "req_1");
    expect(response.status).toBe(200);
    expect((await response.json()).data.rawSse).toBe("data: one\n\ndata: two\n\n");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "view_full_payload", resourceId: "req_1", metadata: { requestPayloadAvailable: true, responsePayloadAvailable: true, eventCount: 2 } }));
    expect(JSON.stringify(mocks.audit.mock.calls[0][1])).not.toContain("secret-content");
  });

  it("does not query payloads when RBAC denies access", async () => {
    mocks.require.mockRejectedValue(new AdminError("ADMIN_PERMISSION_DENIED", "denied", 403));
    const response = await handleGatewayPayloadDetail(new Request("http://localhost/api/admin/gateway-requests/req_1/payload", { headers: { "x-gateway-payload-confirmation": "reveal" } }), "req_1");
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
