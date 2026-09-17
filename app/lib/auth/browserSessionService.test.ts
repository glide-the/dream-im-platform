// [Input] Injected production repository/OAuth grant boundary and original transaction DTO.
// [Output] Unknown-response recovery, conflicting input and cross-client denial evidence.
// [Pos] Provider-free BFF domain tests; no protocol/database duplication.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prior: vi.fn(), create: vi.fn(), lock: vi.fn(), status: vi.fn(), active: vi.fn(), keys: vi.fn(), token: vi.fn(), decrypt: vi.fn() }));
vi.mock("./browserSessionRepository", () => ({ BrowserSessionRepository: class { findTransaction = mocks.prior; create = mocks.create; lockHandle = mocks.lock; setStatus = mocks.status; } }));
vi.mock("./subjectRepository", () => ({ SubjectRepository: class { findActive = mocks.active; } }));
vi.mock("./accessToken", () => ({ adminPublicKeys: mocks.keys, verifyAdminAccessToken: mocks.token }));
vi.mock("./tokenEncryption", () => ({ encryptAuthBundle: (bundle: unknown) => JSON.stringify(bundle), decryptAuthBundle: mocks.decrypt }));
vi.mock("./server", () => ({ handleAuthOnTransaction: vi.fn() }));
vi.mock("./config", async importOriginal => ({ ...await importOriginal<typeof import("./config")>(), authConfiguration: () => ({ issuer: "https://admin.example/api/auth", resource: "https://dream.example/api" }) }));
import { BrowserSessionService, handleHash } from "./browserSessionService";
import type { AuthTransaction } from "./database";
import type { DreamServiceClient } from "./config";
const service: DreamServiceClient = { id: "dream", secret: "s".repeat(32), origin: "https://dream.example", oauthClientId: "dream-browser", redirectUri: "https://dream.example/auth/callback", backgroundScopes: [] };
const input = { request_id: "request_1", transaction_id: "transaction_1", code: "code", code_verifier: "v".repeat(43), redirect_uri: service.redirectUri };
const tx = { execute: vi.fn() } as unknown as AuthTransaction;
const handle = `dbr_${"a".repeat(43)}`;
beforeEach(() => { vi.clearAllMocks(); mocks.decrypt.mockImplementation(JSON.parse); mocks.active.mockResolvedValue({ canonicalUserId: 9007199254740993n }); mocks.token.mockResolvedValue({ subject: "auth-user", clientId: service.oauthClientId, scopes: ["dream:read"], tokenId: "token" }); });
describe("BFF exchange recovery", () => {
  it("returns original encrypted handle after unknown response without consuming code again", async () => {
    const fingerprint = handleHash(JSON.stringify({ transaction_id: input.transaction_id, code: input.code, code_verifier: input.code_verifier, redirect_uri: input.redirect_uri }));
    const expires = new Date(Date.now() + 60_000);
    mocks.prior.mockResolvedValue({ inputSha256: fingerprint, status: "active", expiresAt: expires, tokenCiphertext: JSON.stringify({ handle, service_client_id: service.id, origin: service.origin, oauth_client_id: service.oauthClientId, subject: "auth-user", tokens: { access_token: "token", token_type: "Bearer", expires_in: 300 }, access_expires_at: expires.toISOString() }) });
    const oauth = vi.fn();
    expect(await new BrowserSessionService(tx, service, oauth).exchange(input)).toEqual({ data: { handle, expires_at: expires.toISOString() } });
    expect(oauth).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects conflicting transaction input before grant issuance", async () => {
    mocks.prior.mockResolvedValue({ inputSha256: "other" }); const oauth = vi.fn();
    await expect(new BrowserSessionService(tx, service, oauth).exchange(input)).rejects.toMatchObject({ status: 409 });
    expect(oauth).not.toHaveBeenCalled();
  });
  it("rejects a callback outside the configured exact client URI", async () => {
    const oauth = vi.fn();
    await expect(new BrowserSessionService(tx, service, oauth).exchange({ ...input, redirect_uri: "https://other.example/callback" })).rejects.toMatchObject({ status: 403 });
    expect(oauth).not.toHaveBeenCalled();
  });
  it("commits login-required state for a disabled subject before trying refresh", async () => {
    const expires = new Date(Date.now() + 60_000);
    mocks.lock.mockResolvedValue({ status: "active", expiresAt: expires, authUserId: "auth-user", tokenCiphertext: JSON.stringify({ handle, service_client_id: service.id, origin: service.origin, oauth_client_id: service.oauthClientId, subject: "auth-user", tokens: { access_token: "token", token_type: "Bearer", expires_in: 300 }, access_expires_at: expires.toISOString() }) });
    mocks.active.mockResolvedValue(null); const oauth = vi.fn();
    expect(await new BrowserSessionService(tx, service, oauth).resolve(handle)).toMatchObject({ error: { status: 403 } });
    expect(mocks.status).toHaveBeenCalledWith(handleHash(handle), "login_required"); expect(oauth).not.toHaveBeenCalled();
  });
});
