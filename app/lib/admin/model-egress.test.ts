// [Input] Admin guard decisions, strict mutation bodies and controlled transactional setting/audit writes.
// [Output] Success, permission, origin, conflict and unavailable endpoint evidence without normal data.
// [Pos] Provider-free model-network Admin handler contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), audit: vi.fn(), origin: vi.fn() }));
vi.mock("../platform-db", () => ({
  withPlatformClient: async (fn: (c: { query: typeof mocks.query }) => unknown) => fn({ query: mocks.query }),
  withPlatformTransaction: async (fn: (c: { query: typeof mocks.query }) => unknown) => fn({ query: mocks.query }),
}));
vi.mock("./guard", () => ({ adminRequestId: () => "egress-unit", requireAdminRequest: mocks.identity, assertAdminMutationOrigin: mocks.origin }));
vi.mock("./audit", () => ({ recordAdminAuditOnClient: mocks.audit }));
import { AdminError } from "./errors";
import { handleModelEgressGet, handleModelEgressPatch } from "./model-egress";
const request = (body?: unknown) => new Request("https://admin.invalid/api/admin/model-egress", body === undefined ? {} : { method: "PATCH", headers: { origin: "https://admin.invalid", "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MODEL_EGRESS_PROXY_URL", "http://127.0.0.1:12345");
  let value: unknown;
  mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes("INSERT INTO system_settings")) value = JSON.parse(String(values[3]));
    return { rows: sql.startsWith("SELECT value") && value ? [{ value, status: "active", is_secret: false }] : [] };
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("Admin model network", () => {
  it("persists one revision with the audit and returns a safe effective projection", async () => {
    const response = await handleModelEgressPatch(request({ enabled: true, expectedRevision: null }));
    expect(response.status).toBe(200);
    expect(mocks.identity).toHaveBeenCalledWith(expect.any(Request), "providers.write");
    expect((await response.json()).data).toMatchObject({ desiredEnabled: true, effectiveEnabled: true, revision: 1 });
    expect(mocks.audit).toHaveBeenCalledOnce();
    const read = await handleModelEgressGet(request());
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await read.json())).not.toContain("12345");
    expect(mocks.identity).toHaveBeenLastCalledWith(expect.any(Request), "providers.read");
  });
  it("rejects stale revision without overwriting or auditing", async () => {
    await handleModelEgressPatch(request({ enabled: true, expectedRevision: null }));
    mocks.audit.mockClear(); mocks.query.mockClear();
    const response = await handleModelEgressPatch(request({ enabled: false, expectedRevision: null }));
    expect(response.status).toBe(409);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects extra fields and unavailable proxy before persistence", async () => {
    expect((await handleModelEgressPatch(request({ enabled: true, expectedRevision: null, proxyUrl: "http://secret" }))).status).toBe(400);
    vi.stubEnv("MODEL_EGRESS_PROXY_URL", "");
    expect((await handleModelEgressPatch(request({ enabled: true, expectedRevision: null }))).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([401, 403])("requires server authority for read/write (%s)", async (status) => {
    mocks.identity.mockRejectedValue(new AdminError("ADMIN_PERMISSION_DENIED", "denied", status));
    expect((await handleModelEgressGet(request())).status).toBe(status);
    expect((await handleModelEgressPatch(request({ enabled: true, expectedRevision: null }))).status).toBe(status);
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.identity.mockReset();
  });
  it("rejects invalid Origin before any database access", async () => {
    mocks.origin.mockImplementationOnce(() => { throw new AdminError("ADMIN_ORIGIN_DENIED", "denied", 403); });
    expect((await handleModelEgressPatch(request({ enabled: false, expectedRevision: null }))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
