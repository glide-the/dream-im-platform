// [Input] Injected ORM repository/UOW results and service scopes.
// [Output] Policy success, invalid/missing state and scope/failure boundary verification.
// [Pos] Provider-free domain service tests; production DTOs/entry service are reused.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ row: vi.fn(), transaction: vi.fn() }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./resourceRepository", () => ({ ResourceRepository: class { readPolicy = mocks.row; } }));
import { readResourcePolicy } from "./resourceService";
import type { DreamServiceClient } from "../auth/config";
import { claudeAgentResourcePolicy as policy } from "../../../config/claude-agent-resource-policy";
const service: DreamServiceClient = { id: "dream-browser", secret: "s".repeat(32), origin: "https://dream.example", oauthClientId: "dream", redirectUri: "https://dream.example/callback", backgroundScopes: ["resource-policy:read"] };
beforeEach(() => { vi.clearAllMocks(); mocks.transaction.mockImplementation((_requirements, callback) => callback({})); });
describe("resource policy domain service", () => {
  it("projects valid desired policy through the strict output schema", async () => {
    mocks.row.mockResolvedValue({ value: { schemaVersion: 1, revision: 1, ...policy.defaults }, updatedAt: new Date("2026-09-14T00:00:00Z") });
    expect(await readResourcePolicy(service)).toMatchObject({ status: "configured", updated_at: "2026-09-14T00:00:00.000Z" });
  });
  it("returns missing and invalid states while repository failure propagates unavailable", async () => {
    mocks.row.mockResolvedValueOnce(null).mockResolvedValueOnce({ value: { schemaVersion: 1, revision: 0 }, updatedAt: new Date() }).mockRejectedValueOnce(new Error("repository unavailable"));
    expect(await readResourcePolicy(service)).toEqual({ status: "not_configured", value: null, updated_at: null });
    expect(await readResourcePolicy(service)).toEqual({ status: "invalid", value: null, updated_at: null });
    await expect(readResourcePolicy(service)).rejects.toThrow("repository unavailable");
  });
  it("fails closed before persistence for a different service scope", async () => {
    await expect(readResourcePolicy({ ...service, backgroundScopes: [] })).rejects.toMatchObject({ status: 403 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
