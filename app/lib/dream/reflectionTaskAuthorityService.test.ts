// [Input] Fixed task/section bindings, encrypted rta bearer rows, clock and repository seams.
// [Output] Exact allowlist, restart recovery, maximum-expiry, revocation and entity-denial evidence.
// [Pos] Provider-free Reflections authority gate; no Registry, Route, PostgreSQL, network or Agent.
// [Sync] 2026-09-15: prove a worker restart can recover within the hard maximum without exposing bearer receipts.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lockToken: vi.fn(), lockLive: vi.fn(), create: vi.fn(), renew: vi.fn(), revoke: vi.fn(), revokeTask: vi.fn(), verifyAggregate: vi.fn(), findActive: vi.fn(),
}));
vi.mock("./reflectionTaskAuthorityRepository", () => ({ ReflectionTaskAuthorityRepository: class {
  lockToken = mocks.lockToken; lockLive = mocks.lockLive; create = mocks.create; renew = mocks.renew; revoke = mocks.revoke; revokeTask = mocks.revokeTask; verifyAggregate = mocks.verifyAggregate;
} }));
vi.mock("../auth/subjectRepository", () => ({ SubjectRepository: class { findActive = mocks.findActive; } }));
import type { DataTransaction } from "./database";
import type { ReflectionSectionStorageRow, ReflectionTaskStorageRow } from "./reflectionTaskRepository";
import { encryptAuthBundle } from "../auth/tokenEncryption";
import {
  recoverReflectionTaskAuthority, reflectionAuthorityHash, reflectionTaskAuthorityOperationScopes,
  requireReflectionTaskAuthorityOperation, resolveReflectionTaskAuthority,
} from "./reflectionTaskAuthorityService";

const now = new Date("2026-09-15T00:00:00.000Z"), taskId = "11111111-1111-4111-8111-111111111111", threadId = "22222222-2222-4222-8222-222222222222";
const token = `rta_${"a".repeat(43)}`, tokenHash = reflectionAuthorityHash(token);
const task = {
  id: taskId, userId: "9007199254740993", status: "RUNNING", sectionsJson: '["echoes"]', inputSnapshotJson: "{}", workspacePath: "/private/tmp/reflections/task",
  agentContractVersion: "reflections-agent-v1", errorSummary: null, serviceClientId: "dream", authUserId: "oauth-subject", launchSnapshotJson: "{}", revision: 4,
  createdAt: "2026-09-15 00:00:00+00", startedAt: "2026-09-15 00:00:00+00", completedAt: null, updatedAt: "2026-09-15 00:00:00+00",
} satisfies ReflectionTaskStorageRow;
const section = { taskId, section: "echoes", status: "RUNNING", threadId, resultCount: 0, errorSummary: null, revision: 2, startedAt: "2026-09-15 00:00:00+00", completedAt: null } satisfies ReflectionSectionStorageRow;
const tx = {} as DataTransaction;
function authority(expiresAt: Date, maximumExpiresAt: Date) {
  return { token, purpose: "reflections-worker", task_id: taskId, section: "echoes", thread_id: threadId, scopes: ["dream:read", "dream:write"], expires_at: expiresAt.toISOString(), maximum_expires_at: maximumExpiresAt.toISOString() } as const;
}
function row(expiresAt: Date, maximumExpiresAt: Date, revokedAt: Date | null = null) {
  return {
    tokenHash, serviceClientId: "dream", taskId, section: "echoes", threadId, authUserId: "oauth-subject", canonicalUserId: 9007199254740993n,
    purpose: "reflections-worker", scopes: ["dream:read", "dream:write"], requestId: "begin-1", inputSha256: "b".repeat(64),
    tokenCiphertext: encryptAuthBundle(authority(expiresAt, maximumExpiresAt)), expiresAt, maximumExpiresAt, revokedAt, createdAt: new Date(now.getTime() - 10_000), updatedAt: new Date(now.getTime() - 10_000),
  };
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS", "300"); vi.stubEnv("AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS", "3600");
  mocks.renew.mockResolvedValue(true); mocks.verifyAggregate.mockResolvedValue(true); mocks.findActive.mockResolvedValue({ authUserId: "oauth-subject", canonicalUserId: 9007199254740993n });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("keeps the child persistence surface at the reviewed six operations", () => {
  expect(reflectionTaskAuthorityOperationScopes).toEqual({
    "chat-user-message.persist": "dream:write", "chat-message.persist": "dream:write", "chat-thread.get": "dream:read",
    "chat-thread.update-session": "dream:write", "thread-system-config.get": "dream:read", "session.list": "dream:read",
  });
  expect(() => requireReflectionTaskAuthorityOperation("chat-thread.create")).toThrow("REFLECTION_AUTHORITY_OPERATION_DENIED");
});

it("recovers the same encrypted bearer after short expiry and renews only within the original maximum", async () => {
  const expired = new Date(now.getTime() - 1_000), maximum = new Date(now.getTime() + 600_000); mocks.lockToken.mockResolvedValue(row(expired, maximum));
  const recovered = await recoverReflectionTaskAuthority(tx, tokenHash, task, section, "dream");
  expect(recovered.token).toBe(token);
  expect(mocks.renew).toHaveBeenCalledExactlyOnceWith(tokenHash, new Date(now.getTime() + 300_000), expect.any(String));
  expect(JSON.parse(mocks.renew.mock.calls[0][2])).not.toHaveProperty("token");
});

it.each(["maximum expiry", "revocation", "terminal task", "terminal section"] as const)("rejects recovery after %s", async label => {
  const expired = label === "maximum expiry", revoked = label === "revocation";
  const stored = row(new Date(now.getTime() + (expired ? -2_000 : 10_000)), new Date(now.getTime() + (expired ? -1_000 : 20_000)), revoked ? now : null);
  const taskRow = label === "terminal task" ? { ...task, status: "COMPLETED" } : task;
  const sectionRow = label === "terminal section" ? { ...section, status: "COMPLETED" } : section;
  mocks.lockToken.mockResolvedValue(stored);
  await expect(recoverReflectionTaskAuthority(tx, tokenHash, taskRow as ReflectionTaskStorageRow, sectionRow as ReflectionSectionStorageRow, "dream")).rejects.toMatchObject({ code: "REFLECTION_AUTHORITY_REQUIRED", status: 401 });
  expect(mocks.renew).not.toHaveBeenCalled();
});

it("fails closed when the encrypted bearer cannot be opened after key rotation", async () => {
  const active = row(new Date(now.getTime() + 10_000), new Date(now.getTime() + 20_000)); mocks.lockToken.mockResolvedValue(active); vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", "b".repeat(64));
  await expect(recoverReflectionTaskAuthority(tx, tokenHash, task, section, "dream")).rejects.toMatchObject({ code: "AUTH_BUNDLE_UNAVAILABLE" });
});

it("resolves only an active aggregate-bound subject and denies unknown child operations before storage", async () => {
  const active = row(new Date(now.getTime() + 10_000), new Date(now.getTime() + 20_000)); mocks.lockToken.mockResolvedValue(active);
  await expect(resolveReflectionTaskAuthority(tx, token, "chat-thread.delete", "dream")).rejects.toMatchObject({ code: "REFLECTION_AUTHORITY_OPERATION_DENIED", status: 403 });
  expect(mocks.lockToken).not.toHaveBeenCalled();
  await expect(resolveReflectionTaskAuthority(tx, token, "chat-thread.get", "dream")).resolves.toMatchObject({ threadScope: threadId, taskId, section: "echoes" });
  mocks.verifyAggregate.mockResolvedValue(false);
  await expect(resolveReflectionTaskAuthority(tx, token, "chat-thread.get", "dream")).rejects.toMatchObject({ code: "REFLECTION_AUTHORITY_ENTITY_DENIED", status: 403 });
});
