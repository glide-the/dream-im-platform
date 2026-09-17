import { beforeEach, describe, expect, it, vi } from "vitest";
import { DreamUserRoleService } from "./dream-user-role-service";
import { dreamUserRoleMutationDto } from "./dream-user-role-dto";
import type { DreamUserRoleStore } from "./dream-user-role-repository";

const baseUser = {
  id: "205",
  email: "dream-user@example.com",
  display_name: "Dream User",
  role: "user",
  updated_at: "2026-09-17T00:00:00.000Z",
};

describe("DreamUserRoleService", () => {
  let store: DreamUserRoleStore;
  let lockById: ReturnType<typeof vi.fn>;
  let updateRole: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    lockById = vi.fn().mockResolvedValue(baseUser);
    updateRole = vi.fn().mockResolvedValue({
      ...baseUser,
      role: "admin",
      updated_at: "2026-09-17T00:01:00.000Z",
    });
    store = { lockById, updateRole } as unknown as DreamUserRoleStore;
  });

  it("promotes a Dream product user behind an expected-role fence", async () => {
    const result = await new DreamUserRoleService(store).setRole("205", {
      expectedRole: "user",
      role: "admin",
      reason: "Enable product workflow administration",
    });

    expect(lockById).toHaveBeenCalledWith("205");
    expect(updateRole).toHaveBeenCalledWith("205", "admin");
    expect(result).toMatchObject({
      before: { id: "205", role: "user" },
      after: { id: "205", role: "admin" },
      idempotent: false,
    });
  });

  it("returns an exact target-state replay without issuing another update", async () => {
    lockById.mockResolvedValue({ ...baseUser, role: "admin" });

    const result = await new DreamUserRoleService(store).setRole("205", {
      expectedRole: "user",
      role: "admin",
      reason: "Retry the recorded operation",
    });

    expect(result.idempotent).toBe(true);
    expect(result.before.role).toBe("admin");
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("fails closed when storage contains a role outside the product role set", async () => {
    lockById.mockResolvedValue({ ...baseUser, role: "moderator" });
    await expect(
      new DreamUserRoleService(store).setRole("205", {
        expectedRole: "user",
        role: "admin",
        reason: "Unsupported stored state",
      }),
    ).rejects.toMatchObject({ code: "DREAM_USER_ROLE_DATA_INVALID", status: 503 });
  });

  it("demotes a current Dream product admin", async () => {
    lockById.mockResolvedValue({ ...baseUser, role: "admin" });
    updateRole.mockResolvedValue({ ...baseUser, role: "user" });
    await expect(
      new DreamUserRoleService(store).setRole("205", {
        expectedRole: "admin",
        role: "user",
        reason: "Current demotion",
      }),
    ).resolves.toMatchObject({ after: { role: "user" }, idempotent: false });
  });

  it("requires a real transition in the strict input DTO", () => {
    expect(dreamUserRoleMutationDto.safeParse({
      expectedRole: "user",
      role: "user",
      reason: "No transition",
    }).success).toBe(false);
  });

  it("fails closed when the canonical user is absent", async () => {
    lockById.mockResolvedValue(null);
    await expect(
      new DreamUserRoleService(store).setRole("999", {
        expectedRole: "user",
        role: "admin",
        reason: "Missing user",
      }),
    ).rejects.toMatchObject({ code: "DREAM_USER_NOT_FOUND", status: 404 });
    expect(updateRole).not.toHaveBeenCalled();
  });
});
