// [Input] Admin-verified OAuth current principal and data UOW.
// [Output] Strict current-profile DTO with exact decimal and PG timestamp projection.
// [Pos] Current-user domain service; runtime entity grants do not expose profile data.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { UserProfileRepository } from "./userProfileRepository";
import { pgTimestampToIso } from "./chatThreadDto";
import { userProfileOutputDto } from "./userProfileDto";
export async function currentUserProfile(tx: DataTransaction, principal: PrincipalDto) {
  principalDto.parse(principal);
  if (!principal.scopes.includes("dream:read")) throw new AuthBoundaryError("ACCESS_SCOPE_REQUIRED", 403);
  const result = await new UserProfileRepository(tx).current(principal.canonical_user_id, principal.subject);
  if (!result) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
  const row = result.profile;
  return userProfileOutputDto.parse({ user: { ...row, created_at: pgTimestampToIso(row.created_at), updated_at: pgTimestampToIso(row.updated_at), auth_providers: [...new Set(result.providers)] } });
}
