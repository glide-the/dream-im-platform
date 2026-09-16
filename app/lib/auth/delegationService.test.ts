// [Input] Injected ORM/grant boundaries with controlled OAuth, confirmation claim or Reflections authority ownership.
// [Output] Long-turn binding, source fencing, encrypted recovery and bounded renewal.
// [Pos] Provider-free delegation domain tests; no fixtures in production modules.
// [Sync] 2026-09-16: verify RTA-to-Gateway exchange and live source revocation.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lock: vi.fn(), creation: vi.fn(), claimCreation: vi.fn(), claimSource: vi.fn(), reflection: vi.fn(), owns: vi.fn(), editor: vi.fn(), audit: vi.fn(), key: vi.fn(), active: vi.fn(), activeCanonical: vi.fn(), principal: vi.fn(), create: vi.fn(), renew: vi.fn(), revoke: vi.fn(), receipt: vi.fn(), context: vi.fn() }));
vi.mock("../dream/workflowContextService", () => ({ authoritativeWorkflowContext: mocks.context }));
vi.mock("../dream/reflectionTaskAuthorityService", () => ({
  resolveReflectionTaskAuthority: mocks.reflection,
  resolveReflectionTaskAuthorityHash: mocks.reflection,
}));
vi.mock("./delegationRepository", () => ({ DelegationRepository: class { lock = mocks.lock; findCreation = mocks.creation; findConfirmationClaimCreation = mocks.claimCreation; confirmationClaimSource = mocks.claimSource; ownsEntities = mocks.owns; ownsEditorSession = mocks.editor; auditCreation = mocks.audit; gatewayKeyForClient = mocks.key; gatewayKeyById = mocks.key; create = mocks.create; renew = mocks.renew; revoke = mocks.revoke; } }));
vi.mock("./subjectRepository", () => ({ SubjectRepository: class { findActive = mocks.active; findActiveByCanonicalUserId = mocks.activeCanonical; } }));
vi.mock("./browserSessionService", () => ({ principalForAccessToken: mocks.principal }));
vi.mock("./tokenEncryption", () => ({ encryptAuthBundle: JSON.stringify, decryptAuthBundle: JSON.parse }));
vi.mock("../dream/receipts", () => ({ ReceiptRepository: class { find = mocks.receipt; execute = (_op: unknown, _id: unknown, _input: unknown, _schema: unknown, action: () => unknown) => action(); } }));
import { DelegationService, delegationHash } from "./delegationService";
import type { DataTransaction } from "../dream/database";
import type { DreamServiceClient } from "./config";
import { canonicalContractJson } from "../dream/operationRegistry";
const service: DreamServiceClient = { id: "dream", secret: "s".repeat(32), origin: "https://dream.example", oauthClientId: "browser", redirectUri: "https://dream.example/callback", backgroundScopes: [] };
const token = `idg_${"x".repeat(43)}`, now = Date.parse("2026-09-14T00:00:00Z");
const tx = { execute: vi.fn() } as unknown as DataTransaction;
const input = { purpose: "server-persistence" as const, thread_id: "owned-thread", run_id: null, editor_session_id: null, scopes: ["dream:read", "dream:write"] as const };
const row = () => ({ tokenHash: delegationHash(token), serviceClientId: service.id, authUserId: "auth-user", canonicalUserId: 9007199254740993n, oauthClientId: "browser", requestId: "request1", inputSha256: delegationHash(canonicalContractJson(input)), tokenCiphertext: "encrypted", threadId: "owned-thread", runId: null, purpose: "server-persistence", editorSessionId: null, authoritySource: null, sourceMessageId: null, sourceClaimId: null, sourceReflectionAuthorityHash: null, scopes: ["dream:read", "dream:write"], expiresAt: new Date(now + 300_000), maximumExpiresAt: new Date(now + 600_000), revokedAt: null, gatewayApiKeyId: null });
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("DREAM_DATA_SERVICE_CLIENTS", JSON.stringify([service])); vi.stubEnv("AUTH_DEVICE_CLIENT_ID", "device");
  vi.stubEnv("AUTH_RUNTIME_DELEGATION_TTL_SECONDS", "300"); vi.stubEnv("AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS", "600");
  mocks.lock.mockResolvedValue(row()); mocks.owns.mockResolvedValue(true); mocks.active.mockResolvedValue({ canonicalUserId: 9007199254740993n }); mocks.creation.mockResolvedValue(null);
  mocks.claimCreation.mockResolvedValue(null);
  mocks.activeCanonical.mockResolvedValue({ canonicalUserId: 9007199254740993n, authUserId: "auth-user" });
  mocks.editor.mockResolvedValue(true);
  mocks.receipt.mockResolvedValue(null);
  mocks.context.mockResolvedValue(null);
  mocks.reflection.mockResolvedValue({
    principal: { subject: "auth-user", canonical_user_id: "9007199254740993", client_id: "reflections-worker:dream", scopes: ["dream:read", "dream:write"], status: "active" },
    serviceClientId: service.id, threadScope: "owned-thread", runScope: null,
    tokenHash: "a".repeat(64),
    authority: { maximum_expires_at: new Date(now + 500_000).toISOString() },
  });
  mocks.principal.mockResolvedValue({ subject: "auth-user", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("entity-limited runtime delegation", () => {
  it("keeps precise canonical IDs and accepted thread/scope after OAuth grant expiry", async () => {
    expect(await new DelegationService(tx).resolve(token, "dream:write", service.id, "owned-thread", null)).toMatchObject({ threadId: "owned-thread", principal: { canonical_user_id: "9007199254740993" } });
    expect(mocks.principal).not.toHaveBeenCalled();
  });
  it.each([{ serviceId: "other" }, { threadId: "other" }, { requiredScope: "messages:create" }])("rejects binding mismatch %j", async change => {
    await expect(new DelegationService(tx).resolve(token, change.requiredScope ?? "dream:write", change.serviceId ?? service.id, change.threadId ?? "owned-thread")).rejects.toMatchObject({ status: 403 });
  });
  it.each([{ revokedAt: new Date(now) }, { expiresAt: new Date(now - 1) }, { maximumExpiresAt: null }, { oauthClientId: null }, { inputSha256: null }, { requestId: null }])("fails closed for invalid legacy/expired/revoked row %j", async change => {
    mocks.lock.mockResolvedValue({ ...row(), ...change });
    await expect(new DelegationService(tx).resolve(token, "dream:read")).rejects.toMatchObject({ status: 401 });
  });
  it("refuses disabled subjects and lost ownership", async () => {
    mocks.active.mockResolvedValueOnce(null);
    await expect(new DelegationService(tx).resolve(token, "dream:read")).rejects.toMatchObject({ status: 403 });
    mocks.owns.mockResolvedValueOnce(false);
    await expect(new DelegationService(tx).resolve(token, "dream:read")).rejects.toMatchObject({ status: 404 });
  });
  it("renews within original maximum and never requires a wider scope", async () => {
    const current = { ...row(), purpose: "gateway-cli", gatewayApiKeyId: "gateway-key", scopes: ["models:list"], expiresAt: new Date(now + 500_000) };
    vi.stubEnv("DREAM_GATEWAY_CLIENT_BINDINGS", JSON.stringify([{ service_client_id: service.id, gateway_client_id: "gateway", oauth_client_ids: ["browser"] }])); mocks.key.mockResolvedValue({ clientId: "gateway", scopes: ["models:list"] });
    mocks.lock.mockResolvedValue(current); vi.setSystemTime(now + 400_000);
    expect(await new DelegationService(tx).renew(token, "renew1")).toMatchObject({ expires_at: new Date(now + 600_000).toISOString(), scopes: ["models:list"] });
    expect(mocks.renew).toHaveBeenCalledWith(delegationHash(token), new Date(now + 600_000));
  });
  it("recovers creation from encrypted original result without issuing another credential", async () => {
    const original = { token, purpose: input.purpose, thread_id: input.thread_id, run_id: null, editor_session_id: null, scopes: [...input.scopes], expires_at: new Date(now + 300_000).toISOString(), maximum_expires_at: new Date(now + 600_000).toISOString() };
    mocks.creation.mockResolvedValue({ ...row(), tokenCiphertext: JSON.stringify(original) });
    expect(await new DelegationService(tx).create(service, new Headers({ authorization: "Bearer OAuth" }), "request1", { ...input, scopes: [...input.scopes] })).toEqual(original);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects mixed purpose scopes and another Editor Session at creation/resolve", async () => {
    await expect(new DelegationService(tx).create(service, new Headers(), "request1", { ...input, scopes: ["dream:write", "models:list"] })).rejects.toMatchObject({ code: "DELEGATION_PURPOSE_DENIED", status: 403 });
    mocks.lock.mockResolvedValue({ ...row(), purpose: "editor-stdio", editorSessionId: "session1", scopes: ["editor:read", "editor:write"] });
    await expect(new DelegationService(tx).resolve(token, "editor:write", service.id, undefined, undefined, "session2")).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED" });
    expect(await new DelegationService(tx).resolve(token, "editor:read", service.id, undefined, undefined, "session1")).toMatchObject({ purpose: "editor-stdio", editorSessionId: "session1" });
    mocks.editor.mockResolvedValue(false);
    await expect(new DelegationService(tx).resolve(token, "editor:read")).rejects.toMatchObject({ status: 404 });
  });
  it("rejects unclassified and widened grants even with valid token storage", async () => {
    mocks.lock.mockResolvedValueOnce({ ...row(), purpose: null });
    await expect(new DelegationService(tx).resolve(token, "dream:read")).rejects.toMatchObject({ code: "DELEGATION_PURPOSE_DENIED" });
    mocks.lock.mockResolvedValueOnce({ ...row(), scopes: ["dream:write", "messages:create"] });
    await expect(new DelegationService(tx).resolve(token, "dream:write")).rejects.toMatchObject({ code: "DELEGATION_PURPOSE_DENIED" });
  });
  it("refuses mismatched encrypted recovery and audits one new entity grant", async () => {
    mocks.creation.mockResolvedValueOnce({ ...row(), tokenCiphertext: JSON.stringify({ token, purpose: "server-persistence", thread_id: "other", run_id: null, editor_session_id: null, scopes: [...input.scopes], expires_at: new Date(now + 300_000).toISOString(), maximum_expires_at: new Date(now + 600_000).toISOString() }) });
    await expect(new DelegationService(tx).create(service, new Headers(), "request1", { ...input, scopes: [...input.scopes] })).rejects.toMatchObject({ code: "DELEGATION_RECOVERY_INVALID" });
    const created = await new DelegationService(tx).create(service, new Headers(), "new1", { ...input, scopes: [...input.scopes] });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledWith(service.id, "new1", expect.stringMatching(/^[0-9a-f]{64}$/), delegationHash(created.token));
  });
  it("recovers an already committed renewal after expiry without renewing or reviving the bearer", async () => {
    const original = { purpose: input.purpose, thread_id: input.thread_id, run_id: null, editor_session_id: null, scopes: [...input.scopes], expires_at: new Date(now + 500_000).toISOString(), maximum_expires_at: new Date(now + 600_000).toISOString() };
    mocks.lock.mockResolvedValue({ ...row(), expiresAt: new Date(now - 1), revokedAt: new Date(now) });
    mocks.receipt.mockResolvedValue({ inputSha256: delegationHash(canonicalContractJson({ token_sha256: delegationHash(token) })), threadScope: input.thread_id, editorSessionScope: null, result: original });
    expect(await new DelegationService(tx).renew(token, "renew1")).toEqual(original);
    expect(mocks.renew).not.toHaveBeenCalled();
    await expect(new DelegationService(tx).resolve(token, "dream:write")).rejects.toMatchObject({ status: 401 });
  });
  it("refuses a new expired renewal and another bearer or Session's recovery receipt", async () => {
    mocks.lock.mockResolvedValue({ ...row(), expiresAt: new Date(now - 1) });
    await expect(new DelegationService(tx).renew(token, "new-renew")).rejects.toMatchObject({ status: 401 });
    mocks.receipt.mockResolvedValue({ inputSha256: "other-token", threadScope: input.thread_id, editorSessionScope: null, result: {} });
    await expect(new DelegationService(tx).receipt(token, "runtime-delegation.renew", "old-renew")).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED" });
    expect(mocks.renew).not.toHaveBeenCalled();
  });
  it("rejects broader requested grants and conflicting creation inputs", async () => {
    await expect(new DelegationService(tx).create(service, new Headers(), "request1", { ...input, scopes: ["messages:create"] })).rejects.toMatchObject({ status: 403 });
    mocks.creation.mockResolvedValue({ ...row(), inputSha256: "conflict" });
    await expect(new DelegationService(tx).create(service, new Headers(), "request1", { ...input, scopes: [...input.scopes] })).rejects.toMatchObject({ status: 409 });
  });
  it("compares a new grant with complete authoritative Workflow context instead of trusting run selector", async () => {
    mocks.context.mockResolvedValue({ workflow_run_id: "actual-run" });
    await expect(new DelegationService(tx).create(service, new Headers(), "new1", { ...input, scopes: [...input.scopes] })).rejects.toMatchObject({ code: "DELEGATION_WORKFLOW_CONTEXT_DENIED", status: 403 });
    expect(mocks.create).not.toHaveBeenCalled();
    await new DelegationService(tx).create(service, new Headers(), "new2", { ...input, run_id: "actual-run", scopes: [...input.scopes] });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("exchanges live Reflections authority for a separate source-fenced Gateway grant", async () => {
    vi.stubEnv("DREAM_GATEWAY_CLIENT_BINDINGS", JSON.stringify([{ service_client_id: service.id, gateway_client_id: "gateway", oauth_client_ids: ["browser"] }]));
    mocks.key.mockResolvedValue({ id: "gateway-key", clientId: "gateway", scopes: ["messages:create", "messages:count_tokens", "models:list"] });
    const gatewayInput = { purpose: "gateway-cli" as const, thread_id: "owned-thread", run_id: null, editor_session_id: null, scopes: ["messages:create", "messages:count_tokens", "models:list"] as const };
    const created = await new DelegationService(tx).createForReflectionAuthority(
      service, `rta_${"r".repeat(43)}`, "reflection-request", { ...gatewayInput, scopes: [...gatewayInput.scopes] },
    );
    const stored = mocks.create.mock.calls[0][0];
    expect(stored).toMatchObject({
      authoritySource: "reflection-task-authority",
      sourceReflectionAuthorityHash: "a".repeat(64),
      authUserId: "auth-user", canonicalUserId: 9007199254740993n,
      purpose: "gateway-cli", gatewayApiKeyId: "gateway-key",
      threadId: "owned-thread", runId: null,
    });
    expect(stored.tokenCiphertext).not.toContain("rta_");
    expect(created.maximum_expires_at).toBe(new Date(now + 500_000).toISOString());
    mocks.lock.mockResolvedValue(stored);
    expect(await new DelegationService(tx).resolve(
      created.token, "messages:create", service.id, "owned-thread", null,
    )).toMatchObject({ purpose: "gateway-cli", threadId: "owned-thread" });
    mocks.reflection.mockRejectedValueOnce(new Error("source revoked"));
    await expect(new DelegationService(tx).resolve(created.token, "messages:create"))
      .rejects.toThrow("source revoked");
  });

  it("derives and recovers one server-persistence grant from the exact live confirmation claim", async () => {
    const claimService = { ...service, backgroundScopes: ["story-confirmation:dispatch"] as const };
    const binding = {
      messageId: `dream_confirm_${"a".repeat(64)}`,
      claimId: "claim-1",
      actorId: "9007199254740993",
      threadId: "owned-thread",
      runId: `run_${"b".repeat(32)}`,
    };
    mocks.claimSource.mockResolvedValue({
      id: binding.messageId,
      role: "user",
      actorId: binding.actorId,
      metadataJson: JSON.stringify({
        kind: "story-workspace-dream-confirmation",
        actor: binding.actorId,
        story_workspace_run_id: binding.runId,
        thread_id: binding.threadId,
        base_revisions: { characters: 1, scenes: 1, storyboards: 1 },
        edit_count: 0,
        command_fingerprint: `sha256:${"c".repeat(64)}`,
        idempotency_key: "swc_claim-1",
        request_id: "submit-1",
        dispatch_status: "dispatching",
        dispatch_claim_id: binding.claimId,
        dispatch_claim_lease_until: now / 1_000 + 120,
      }),
      nowSeconds: now / 1_000,
    });
    const created = await new DelegationService(tx).createForConfirmationClaim(claimService, binding);
    const stored = mocks.create.mock.calls[0][0];
    expect(stored).toMatchObject({
      serviceClientId: service.id,
      authUserId: "auth-user",
      canonicalUserId: 9007199254740993n,
      threadId: binding.threadId,
      runId: binding.runId,
      purpose: "server-persistence",
      authoritySource: "story-confirmation-claim",
      sourceMessageId: binding.messageId,
      sourceClaimId: binding.claimId,
      scopes: ["dream:read", "dream:write"],
    });
    mocks.claimCreation.mockResolvedValue(stored);
    mocks.lock.mockResolvedValue(stored);
    expect(await new DelegationService(tx).createForConfirmationClaim(claimService, binding)).toEqual(created);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("fences a claim-bound grant before data access when its lease or claim changes", async () => {
    const binding = {
      messageId: `dream_confirm_${"a".repeat(64)}`,
      claimId: "claim-1",
      actorId: "9007199254740993",
      threadId: "owned-thread",
      runId: `run_${"b".repeat(32)}`,
    };
    mocks.lock.mockResolvedValue({
      ...row(),
      runId: binding.runId,
      authoritySource: "story-confirmation-claim",
      sourceMessageId: binding.messageId,
      sourceClaimId: binding.claimId,
    });
    mocks.claimSource.mockResolvedValue({
      id: binding.messageId,
      role: "user",
      actorId: binding.actorId,
      metadataJson: JSON.stringify({
        kind: "story-workspace-dream-confirmation",
        actor: binding.actorId,
        story_workspace_run_id: binding.runId,
        thread_id: binding.threadId,
        base_revisions: { characters: 1, scenes: 1, storyboards: 1 },
        edit_count: 0,
        command_fingerprint: `sha256:${"c".repeat(64)}`,
        idempotency_key: "swc_claim-1",
        request_id: "submit-1",
        dispatch_status: "dispatching",
        dispatch_claim_id: "another-claim",
        dispatch_claim_lease_until: now / 1_000 + 120,
      }),
      nowSeconds: now / 1_000,
    });
    await expect(new DelegationService(tx).resolve(token, "dream:read"))
      .rejects.toMatchObject({ code: "DELEGATION_REQUIRED", status: 401 });
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.owns).not.toHaveBeenCalled();
  });
});
