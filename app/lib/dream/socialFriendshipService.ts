// [Input] Closed social request and verified current OAuth actor in the shared Admin data UOW.
// [Output] Strict result without a new connection/transaction or entity-grant privilege.
// [Pos] Social domain service composition; Admin thin handlers own authentication/receipts.
// [Sync] 2026-09-15: legacy invite policy is explicit server config and every relationship decision stays atomic.
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { SocialFriendshipRepository } from "./socialFriendshipRepository";
import * as dto from "./socialFriendshipDto";
export const socialFriendshipSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export function configuredSocialFriendshipPolicy() {
  let raw: unknown;
  try { raw = JSON.parse(requiredAuthValue("DREAM_FRIENDSHIP_POLICY_JSON")); } catch { throw new AuthBoundaryError("FRIENDSHIP_POLICY_NOT_CONFIGURED"); }
  const parsed = dto.socialFriendshipPolicyDto.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("FRIENDSHIP_POLICY_NOT_CONFIGURED");
  return parsed.data;
}
export async function runSocialFriendshipOperation(operation: dto.SocialFriendshipOperation, rawInput: unknown, actor: ChatThreadActor, tx: DataTransaction, policy?: dto.SocialFriendshipPolicy) {
  const contract = dto.socialFriendshipOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const repository = new SocialFriendshipRepository(tx, principal.canonical_user_id);
  let result: unknown;
  switch (operation) {
    case "friend-invite.generate": result = await repository.generate(policy === undefined ? configuredSocialFriendshipPolicy() : dto.socialFriendshipPolicyDto.parse(policy)); break;
    case "friend-invite.use": result = await repository.use(dto.friendInviteInputDto.parse(input.data).code); break;
    case "friend-request.list": result = await repository.requests(); break;
    case "friend-request.accept": result = await repository.decide(dto.friendRequestInputDto.parse(input.data).request_id, "accepted"); break;
    case "friend-request.reject": result = await repository.decide(dto.friendRequestInputDto.parse(input.data).request_id, "rejected"); break;
    case "friendship.list": result = await repository.friends(); break;
    case "friendship.remove": result = await repository.remove(dto.friendSelectorInputDto.parse(input.data).friend_id); break;
    case "friendship.timeline": { const query = dto.friendTimelineInputDto.parse(input.data); result = await repository.timeline(query.friend_id, query.limit); break; }
    case "friendship.picture-full": { const query = dto.friendPictureInputDto.parse(input.data); result = await repository.picture(query.friend_id, query.date); break; }
  }
  return contract.output.parse(result);
}
