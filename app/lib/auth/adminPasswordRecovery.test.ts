// [Input] Provider-free recovery DTO/service with repository and scrypt hashing injected.
// [Output] Coverage for redacted planning, active-member enforcement, password replacement and Session revocation.
// [Pos] Deterministic Admin-only password recovery service tests.
// [Sync] 2026-09-17: prove lockout recovery does not expose credentials or enter the Dream identity domain.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  lock: vi.fn(),
  replace: vi.fn(),
  hash: vi.fn(),
}));

vi.mock("./adminSessionRepository", () => ({
  AdminSessionRepository: class {
    findByNormalizedEmail = mocks.find;
    lockActiveByNormalizedEmail = mocks.lock;
    replacePasswordAndRevokeSessions = mocks.replace;
  },
}));
vi.mock("../admin/password", () => ({
  ADMIN_PASSWORD_MIN_LENGTH: 14,
  hashAdminPassword: mocks.hash,
}));

import { applyAdminPasswordRecovery, planAdminPasswordRecovery } from "./adminPasswordRecovery";
import type { AuthTransaction } from "./database";

const tx = {} as AuthTransaction;
const member = {
  id: "admin-1",
  email: "admin@example.test",
  displayName: "Operator",
  passwordHash: "existing-hash",
  status: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(member);
  mocks.lock.mockResolvedValue(member);
  mocks.hash.mockResolvedValue("replacement-scrypt-hash");
  mocks.replace.mockResolvedValue(2);
});

describe("Admin password recovery", () => {
  it("returns a redacted dry-run plan for one active Admin member", async () => {
    await expect(planAdminPasswordRecovery(tx, {
      email: " ADMIN@example.test ",
      requestId: "recovery-1",
    })).resolves.toEqual({
      mode: "dry-run",
      email: "admin@example.test",
      status: "active",
      willRevokeAdminSessions: true,
      dreamIdentityChanged: false,
    });
    expect(mocks.find).toHaveBeenCalledWith("admin@example.test");
  });

  it("hashes the validated password and atomically revokes existing Admin Sessions", async () => {
    const receipt = await applyAdminPasswordRecovery(tx, {
      email: "admin@example.test",
      requestId: "recovery-2",
      password: "new-admin-password",
    });
    expect(mocks.hash).toHaveBeenCalledWith("new-admin-password");
    expect(mocks.replace).toHaveBeenCalledWith({
      adminUserId: "admin-1",
      passwordHash: "replacement-scrypt-hash",
      requestId: "recovery-2",
    });
    expect(receipt).toEqual({
      mode: "apply",
      email: "admin@example.test",
      passwordChanged: true,
      sessionsRevoked: 2,
      dreamIdentityChanged: false,
    });
    expect(JSON.stringify(receipt)).not.toContain("new-admin-password");
    expect(JSON.stringify(receipt)).not.toContain("replacement-scrypt-hash");
  });

  it("fails closed for an inactive member or a password below the policy minimum", async () => {
    mocks.find.mockResolvedValue({ ...member, status: "disabled" });
    await expect(planAdminPasswordRecovery(tx, {
      email: "admin@example.test",
      requestId: "recovery-3",
    })).rejects.toThrow("ADMIN_PASSWORD_RECOVERY_TARGET_INACTIVE");
    await expect(applyAdminPasswordRecovery(tx, {
      email: "admin@example.test",
      requestId: "recovery-4",
      password: "too-short",
    })).rejects.toThrow();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
