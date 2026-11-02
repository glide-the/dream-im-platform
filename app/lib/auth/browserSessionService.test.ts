// [Input] Injected production repository/OAuth grant boundary and original transaction DTO.
// [Output] Unknown-response recovery, conflicting input and cross-client denial evidence.
// [Pos] Provider-free BFF domain tests; no protocol/database duplication.
// [Sync] 2026-10-31: admit only explicit same-service account redirects and retain URI-bound original-transaction recovery.
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
  it("exchanges an explicit account callback on the same original Client and leaves unknown callbacks outside the transaction", async () => {
    const app = "com.inkmemory.example.auth:/auth/callback";
    const local: DreamServiceClient = { ...service, origin: "http://localhost:5173", redirectUri: "http://localhost:5173/auth/callback", redirectUris: [app] };
    mocks.prior.mockResolvedValue(null);
    const oauth = vi.fn().mockResolvedValue({ data: { access_token: "token", token_type: "Bearer", expires_in: 300 } });
    vi.stubEnv("AUTH_BROWSER_SESSION_TTL_SECONDS", "3600");
    try {
      const result = await new BrowserSessionService(tx, local, oauth).exchange({ ...input, redirect_uri: app });
      expect(result.data?.handle).toMatch(/^dbr_[A-Za-z0-9_-]{43}$/);
      expect(oauth).toHaveBeenCalledWith({ grant_type: "authorization_code", code: input.code, code_verifier: input.code_verifier, redirect_uri: app });
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(JSON.parse(mocks.create.mock.calls[0][0].tokenCiphertext)).toMatchObject({ service_client_id: service.id, origin: local.origin, oauth_client_id: service.oauthClientId });
    } finally { vi.unstubAllEnvs(); }
    vi.clearAllMocks();
    const denied = new BrowserSessionService(tx, local, oauth);
    for (const redirect_uri of ["com.other.app.auth:/auth/callback", app + "?code=extra", "com.inkmemory.example.mcp:/oauth/callback", service.redirectUri]) {
      await expect(denied.exchange({ ...input, redirect_uri })).rejects.toMatchObject({ code: "AUTH_REDIRECT_DENIED", status: 403 });
    }
    expect(tx.execute).not.toHaveBeenCalled(); expect(oauth).not.toHaveBeenCalled();
  });
  it("recovers the original account URI transaction and rejects replay of its code on the primary Web URI", async () => {
    const app = "com.inkmemory.example.auth:/auth/callback";
    const local: DreamServiceClient = { ...service, origin: "http://localhost:5173", redirectUri: "http://localhost:5173/auth/callback", redirectUris: [app] };
    const native = { ...input, redirect_uri: app };
    const fingerprint = handleHash(JSON.stringify({ transaction_id: native.transaction_id, code: native.code, code_verifier: native.code_verifier, redirect_uri: app }));
    const expires = new Date(Date.now() + 60_000);
    mocks.prior.mockResolvedValue({ inputSha256: fingerprint, status: "active", expiresAt: expires, tokenCiphertext: JSON.stringify({ handle, service_client_id: local.id, origin: local.origin, oauth_client_id: local.oauthClientId, subject: "auth-user", tokens: { access_token: "token", token_type: "Bearer", expires_in: 300 }, access_expires_at: expires.toISOString() }) });
    const oauth = vi.fn(), instance = new BrowserSessionService(tx, local, oauth);
    expect(await instance.exchange(native)).toEqual({ data: { handle, expires_at: expires.toISOString() } });
    await expect(instance.exchange({ ...input, redirect_uri: local.redirectUri })).rejects.toMatchObject({ code: "BROWSER_TRANSACTION_CONFLICT", status: 409 });
    expect(oauth).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
