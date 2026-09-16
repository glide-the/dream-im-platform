// [Input] Claude Plugin user/background write request IDs and exact original service authority.
// [Output] Strict committed/absent recovery bound to OAuth subject or plugins:catalog service actor.
// [Pos] Provider-free unknown-COMMIT recovery test; it never reissues a plugin mutation.
// [Sync] 2026-09-16: cover Registry175-184 original receipt recovery.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), find: vi.fn(), construct: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(...args: unknown[]) { mocks.construct(...args); }
  find = mocks.find;
} }));

import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";

const requestId = "plugin-original";
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };
const plan = { accepted: true, operation_id: "cop_operation", package_spec: "demo@market",
  marketplace_entry_id: null, requested_source_type: null, marketplace_source: null };
const builtin = { action: "install", plan: { ...plan, operation_id: "cop_builtin",
  package_spec: "ink-dream-story@platform-builtin", requested_source_type: "platform-builtin" } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ id: "dream-service", backgroundScopes: ["plugins:catalog"] });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
});

function read(operation: string, authorization = false, suffix = "") {
  return GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=${operation}${suffix}`,
    { headers: authorization ? { authorization: "Bearer oauth" } : {} },
  ), { params: Promise.resolve({ requestId }) });
}

it("recovers a user lifecycle write under the original OAuth subject", async () => {
  mocks.find.mockResolvedValue({ inputSha256: "a".repeat(64), result: plan,
    threadScope: null, editorSessionScope: null, runScope: null });
  const response = await read("claude-plugin.install.prepare", true);
  expect(response.status).toBe(200);
  expect((await response.json()).data.status).toBe("committed");
  expect(mocks.construct).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "dream-service", "subject");
});

it("recovers builtin writes only under the service background actor", async () => {
  mocks.find.mockResolvedValue({ inputSha256: "b".repeat(64), result: builtin,
    threadScope: null, editorSessionScope: null, runScope: null });
  const response = await read("claude-plugin.builtin.ensure");
  expect(response.status).toBe(200);
  expect((await response.json()).data.result).toEqual(builtin);
  expect(mocks.construct).toHaveBeenCalledExactlyOnceWith(
    { marker: "tx" }, "dream-service", "background:dream-service",
  );
  expect(mocks.principal).not.toHaveBeenCalled();
});

it("rejects extra selectors, browser credentials and malformed stored evidence", async () => {
  expect((await read("claude-plugin.install.prepare", true, "&user_id=42")).status).toBe(404);
  expect((await read("claude-plugin.builtin.ensure", true)).status).toBe(400);
  mocks.find.mockResolvedValue({ inputSha256: "invalid", result: builtin,
    threadScope: null, editorSessionScope: null, runScope: null });
  expect((await read("claude-plugin.builtin.ensure")).status).toBe(503);
});
