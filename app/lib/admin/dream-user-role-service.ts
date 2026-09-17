// [Input] Strict Dream user-role DTOs and a typed row-locking repository.
// [Output] One expected-role-fenced product-role transition or an idempotent replay result.
// [Pos] Dream product-role domain service; Admin membership and Better Auth subjects are outside this boundary.
// [Sync] 2026-09-17: define closed user/admin transitions with stale-write and invalid-storage failure handling.
import { AdminError } from "./errors";
import {
  dreamProductRoleDto,
  dreamUserRoleRecordDto,
  type DreamUserRoleMutation,
  type DreamUserRoleRecord,
} from "./dream-user-role-dto";
import type { DreamUserRoleStore } from "./dream-user-role-repository";

export type DreamUserRoleTransition = {
  before: DreamUserRoleRecord;
  after: DreamUserRoleRecord;
  idempotent: boolean;
};

export class DreamUserRoleService {
  constructor(private readonly store: DreamUserRoleStore) {}

  async setRole(
    canonicalUserId: string,
    input: DreamUserRoleMutation,
  ): Promise<DreamUserRoleTransition> {
    const stored = await this.store.lockById(canonicalUserId);
    if (!stored) {
      throw new AdminError(
        "DREAM_USER_NOT_FOUND",
        "The canonical Dream user does not exist",
        404,
      );
    }
    const role = dreamProductRoleDto.safeParse(stored.role);
    if (!role.success) {
      throw new AdminError(
        "DREAM_USER_ROLE_DATA_INVALID",
        "The stored Dream product role is outside the supported role set",
        503,
      );
    }
    const before = dreamUserRoleRecordDto.parse({ ...stored, role: role.data });
    if (before.role === input.role) {
      return { before, after: before, idempotent: true };
    }
    if (before.role !== input.expectedRole) {
      throw new AdminError(
        "DREAM_USER_ROLE_CONFLICT",
        "The Dream product role changed; reload the user before retrying",
        409,
        { currentRole: before.role, expectedRole: input.expectedRole },
      );
    }
    const updated = await this.store.updateRole(canonicalUserId, input.role);
    if (!updated) {
      throw new AdminError(
        "DREAM_USER_ROLE_CONFLICT",
        "The Dream product role could not be updated",
        409,
      );
    }
    const after = dreamUserRoleRecordDto.parse(updated);
    return { before, after, idempotent: false };
  }
}
