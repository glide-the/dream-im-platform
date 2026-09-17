// [Input] Notion user/background write request IDs and exact original authority selectors.
// [Output] Strict committed/absent recovery bound to OAuth subject or stored connector-derived sync actor.
// [Pos] Provider-free unknown-COMMIT recovery test; it never reissues a Notion mutation.
// [Sync] 2026-09-17: verify separate user/service Bearers and scheduled-sync receipt authority.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), find: vi.fn(), construct: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({
  ReceiptRepository: class {
    constructor(...args: unknown[]) { mocks.construct(...args); }
    find = mocks.find;
  },
}));

import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";

const requestId = "notion-original";
const connectorId = "00000000-0000-4000-8000-000000000001";
const connector = {
  id: connectorId, user_id: "42", name: "Notion", platform: "notion", auth_status: "authenticated",
  config: {}, current_snapshot_version: null, current_source_revision: null, current_sync_cursor: null,
  last_synced_at: null, created_at: "2026-09-16T00:00:00.000Z",
  updated_at: "2026-09-16T00:00:00.000Z", sources: [],
};
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:write"], status: "active" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ id: "dream-service", backgroundScopes: ["connectors:sync"] });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
});

function userRead(suffix = "") {
  return GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=notion.connector.patch${suffix}`,
    { headers: { authorization: "Bearer oauth", "x-ink-dream-service-authorization": "Bearer service-token" } },
  ), { params: Promise.resolve({ requestId }) });
}
function backgroundRead(suffix = "") {
  return GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=notion.sync-connector.patch&connector_id=${connectorId}${suffix}`,
    { headers: { authorization: "Bearer service-token" } },
  ), { params: Promise.resolve({ requestId }) });
}

it("recovers a user write under the original OAuth subject", async () => {
  mocks.find.mockResolvedValue({
    inputSha256: "a".repeat(64), result: { connector },
    threadScope: null, editorSessionScope: null, runScope: null,
  });
  const response = await userRead();
  expect(response.status).toBe(200);
  expect((await response.json()).data.status).toBe("committed");
  expect(mocks.construct).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "dream-service", "subject");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith("notion.connector.patch", requestId);
});

it("recovers a scheduled write only under connector-derived receipt authority", async () => {
  mocks.find.mockResolvedValue({
    inputSha256: "b".repeat(64), result: { connector },
    threadScope: null, editorSessionScope: null, runScope: null,
  });
  const response = await backgroundRead();
  expect(response.status).toBe(200);
  expect((await response.json()).data.status).toBe("committed");
  expect(mocks.construct).toHaveBeenCalledExactlyOnceWith(
    { marker: "tx" }, "dream-service", `notion-sync:${connectorId}`,
  );
  expect(mocks.principal).not.toHaveBeenCalled();
});

it("rejects extra selectors, browser credentials and malformed stored evidence", async () => {
  expect((await userRead("&user_id=42")).status).toBe(404);
  const withBrowser = GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=notion.sync-connector.patch&connector_id=${connectorId}`,
    { headers: { authorization: "Bearer oauth", "x-ink-dream-service-authorization": "Bearer service-token" } },
  ), { params: Promise.resolve({ requestId }) });
  expect((await withBrowser).status).toBe(400);
  mocks.find.mockResolvedValue({
    inputSha256: "invalid", result: { connector },
    threadScope: null, editorSessionScope: null, runScope: null,
  });
  expect((await backgroundRead()).status).toBe(503);
});
