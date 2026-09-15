// [Input] Real Gateway authentication with injected Admin verifier/identity/data persistence boundaries.
// [Output] Key billing identity, exact canonical mapping, live scope/client checks and opaque runtime isolation.
// [Pos] Provider-free Gateway authority contract; cryptography is covered by auth/accessToken.test.ts.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn(), active: vi.fn(), resolve: vi.fn() }));
vi.mock("../platform-db", () => ({ withPlatformClient: (callback: (tx: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }) }));
vi.mock("../auth/accessToken", () => ({ verifyAdminAccessToken: mocks.verify }));
vi.mock("../auth/database", () => ({ withAuthTransaction: (callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("../auth/subjectRepository", () => ({ SubjectRepository: class { findActive = mocks.active; } }));
vi.mock("../dream/database", () => ({ withDataTransaction: (_requirements: unknown, callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("../auth/delegationService", () => ({ DelegationService: class { resolve = mocks.resolve; } }));
import { authenticateGatewayRequest } from "./auth";
import { AuthBoundaryError } from "../auth/config";
const plaintext = "gw_unit-key-never-used-outside-unit-tests";
const identity = { canonical_user_id: "9007199254740993", platform_user_id: "usr_canonical", source: "ink-dream", external_user_id: "9007199254740993", tier: "creator", daily_token_limit: 200000, monthly_token_limit: null };
const serviceKey = { api_key_id: "service-key", platform_user_id: null, subject_mode: "canonical_subject", service_client_id: "gateway-dream", scopes: ["messages:create", "models:list"], canonical_user_id: null };
function database(key: Record<string, unknown> = serviceKey, projection: Record<string, unknown> | null = identity) {
  mocks.query.mockImplementation(async (statement: unknown) => {
    const sql = String(statement);
    if (sql.includes("FROM gateway_api_keys AS k")) return { rows: [key] };
    if (sql.includes("SELECT id, scopes FROM gateway_api_keys")) return { rows: [{ id: "service-key", scopes: ["messages:create"] }] };
    if (sql.includes("FROM users AS canonical_user")) return { rows: projection ? [projection] : [] };
    if (sql.includes("UPDATE gateway_api_keys")) return { rows: [], rowCount: 1 };
    throw new Error("Unexpected repository query");
  });
}
const headers = () => new Headers({ "x-api-key": plaintext, authorization: "Bearer Admin-OAuth-grant" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GATEWAY_API_KEY_PEPPER", "p".repeat(32));
  vi.stubEnv("DREAM_GATEWAY_CLIENT_BINDINGS", JSON.stringify([{ service_client_id: "dream", gateway_client_id: "gateway-dream", oauth_client_ids: ["browser", "device"] }]));
  mocks.verify.mockResolvedValue({ subject: "auth-sub", clientId: "browser", tokenId: "jti", scopes: ["openid", "dream:read", "messages:create"] });
  mocks.active.mockResolvedValue({ canonicalUserId: 9007199254740993n });
  database();
});
afterEach(() => vi.unstubAllEnvs());
describe("Gateway Admin authority", () => {
  it("retains fixed-user billing identity and active canonical ownership checks", async () => {
    database({ ...identity, api_key_id: "fixed-key", service_client_id: null, subject_mode: null, scopes: ["messages:create"] });
    expect(await authenticateGatewayRequest(new Headers({ authorization: `Bearer ${plaintext}` }), "messages:create")).toMatchObject({ apiKeyId: "fixed-key", platformUserId: identity.platform_user_id, externalUserId: identity.external_user_id });
    expect(String(mocks.query.mock.calls[0][0])).toContain("canonical_user.status = 'active'");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("maps separate OAuth subjects via explicit links preserving bigint and key billing ownership", async () => {
    expect(await authenticateGatewayRequest(headers(), "messages:create")).toMatchObject({ apiKeyId: "service-key", externalUserId: "9007199254740993", scopes: ["messages:create"] });
    expect(mocks.active).toHaveBeenCalledWith("auth-sub");
    const call = mocks.query.mock.calls.find(([sql]) => String(sql).includes("FROM users AS canonical_user"));
    expect(call?.[1]).toEqual(["9007199254740993"]);
  });
  it("refuses an OAuth client not explicitly bound to the active Gateway key", async () => {
    mocks.verify.mockResolvedValue({ subject: "auth-sub", clientId: "other-client", tokenId: "jti", scopes: ["messages:create"] });
    await expect(authenticateGatewayRequest(headers(), "messages:create")).rejects.toMatchObject({ status: 401 });
    expect(mocks.active).not.toHaveBeenCalled();
  });
  it.each([[401, "GATEWAY_SUBJECT_TOKEN_INVALID"], [403, "GATEWAY_SCOPE_REQUIRED"], [503, "GATEWAY_AUTH_NOT_CONFIGURED"]] as const)("preserves Admin token refusal %s", async (status, code) => {
    mocks.verify.mockRejectedValue(new AuthBoundaryError("BOUNDARY", status));
    await expect(authenticateGatewayRequest(headers(), "messages:create")).rejects.toMatchObject({ status, code });
  });
  it("refuses missing canonical link or active platform projection", async () => {
    mocks.active.mockResolvedValueOnce(null);
    await expect(authenticateGatewayRequest(headers(), "messages:create")).rejects.toMatchObject({ status: 403, code: "GATEWAY_CANONICAL_USER_REQUIRED" });
    database(serviceKey, null);
    await expect(authenticateGatewayRequest(headers(), "messages:create")).rejects.toMatchObject({ status: 403, code: "GATEWAY_CANONICAL_USER_REQUIRED" });
  });
  it("refuses key scope loss and malformed explicit binding configuration", async () => {
    database({ ...serviceKey, scopes: ["models:list"] });
    await expect(authenticateGatewayRequest(headers(), "messages:create")).rejects.toMatchObject({ status: 403 });
    database(); vi.stubEnv("DREAM_GATEWAY_CLIENT_BINDINGS", "[]");
    await expect(authenticateGatewayRequest(headers(), "messages:create")).rejects.toMatchObject({ status: 503 });
  });
  it("accepts entity-bound runtime proof without sharing or hashing a service key", async () => {
    const token = `idg_${"x".repeat(43)}`;
    mocks.resolve.mockResolvedValue({ gatewayApiKeyId: "service-key", principal: { canonical_user_id: "9007199254740993", scopes: ["messages:create"] }, threadId: "owned-thread" });
    delete process.env.GATEWAY_API_KEY_PEPPER;
    expect(await authenticateGatewayRequest(new Headers({ authorization: `Bearer ${token}` }), "messages:create")).toMatchObject({ apiKeyId: "service-key", scopes: ["messages:create"] });
    expect(mocks.resolve).toHaveBeenCalledWith(token, "messages:create");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("refuses revoked/expired runtime proof and runtime proof without Gateway grant", async () => {
    const token = `idg_${"x".repeat(43)}`;
    mocks.resolve.mockRejectedValueOnce(new AuthBoundaryError("DELEGATION_REQUIRED", 401));
    await expect(authenticateGatewayRequest(new Headers({ authorization: `Bearer ${token}` }), "messages:create")).rejects.toMatchObject({ status: 401 });
    mocks.resolve.mockResolvedValueOnce({ gatewayApiKeyId: null });
    await expect(authenticateGatewayRequest(new Headers({ authorization: `Bearer ${token}` }), "messages:create")).rejects.toMatchObject({ status: 401 });
  });
  it("refuses caller user override before any database or verifier access", async () => {
    await expect(authenticateGatewayRequest(new Headers({ "x-api-key": plaintext, "x-user-id": "other" }), "messages:create")).rejects.toMatchObject({ status: 400 });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
  });
});
