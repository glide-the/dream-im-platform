// [Input] Nine named social operations without caller-authored acting identities or database selectors.
// [Output] Strict bigint/timestamp/NULL DTOs and closed legacy product errors.
// [Pos] Admin invitation/friendship contract; Dream retains product routes and image display.
// [Sync] 2026-09-15: atomic invitation consumption, recipient decisions and relationship-authorized pictures.
import { z } from "zod";
import { decimalIdDto, isoTimeDto } from "../auth/dto";

export const socialFriendshipPolicyDto = z.strictObject({
  code_length: z.number().int().positive().safe(),
  lifetime_seconds: z.number().int().positive().safe(),
  generation_attempts: z.number().int().positive().safe(),
});
export type SocialFriendshipPolicy = z.infer<typeof socialFriendshipPolicyDto>;
const empty = z.strictObject({});
export const friendInviteInputDto = z.strictObject({ code: z.string() });
export const friendRequestInputDto = z.strictObject({ request_id: decimalIdDto });
export const friendSelectorInputDto = z.strictObject({ friend_id: decimalIdDto });
export const friendTimelineInputDto = friendSelectorInputDto.extend({ limit: z.number().int().nonnegative().safe() });
export const friendPictureInputDto = friendSelectorInputDto.extend({ date: z.string() });
export const socialFailureDto = z.strictObject({ success: z.literal(false), error: z.enum([
  "Invalid invite code", "Invite code already used", "Invite code expired", "Cannot add yourself as friend",
  "Already friends", "Friend request already pending", "Request not found", "Permission denied",
  "Request already accepted", "Request already rejected", "Friendship not found",
]) });
export const socialDecisionResultDto = z.discriminatedUnion("success", [z.strictObject({ success: z.literal(true) }), socialFailureDto]);
export const friendInviteUseResultDto = z.discriminatedUnion("success", [z.strictObject({
  success: z.literal(true), friend_request_id: decimalIdDto, inviter_id: decimalIdDto, inviter_name: z.string(),
}), socialFailureDto]);
export const pendingFriendRequestDto = z.strictObject({ id: decimalIdDto, requester_id: decimalIdDto, requester_name: z.string(), created_at: isoTimeDto.nullable() });
export const acceptedFriendDto = z.strictObject({ friend_id: decimalIdDto, friend_name: z.string(), friend_email: z.string(), since: isoTimeDto.nullable() });
export const friendPictureDto = z.strictObject({ date: z.string(), base64: z.string(), prompt: z.string().nullable(), created_at: isoTimeDto.nullable() });
export const socialFriendshipOperationContracts = {
  "friend-invite.generate": { kind: "write", userScope: "dream:write", input: empty, output: z.strictObject({ code: z.string().min(1), expires_at: isoTimeDto }) },
  "friend-invite.use": { kind: "write", userScope: "dream:write", input: friendInviteInputDto, output: friendInviteUseResultDto },
  "friend-request.list": { kind: "read", userScope: "dream:read", input: empty, output: z.strictObject({ requests: z.array(pendingFriendRequestDto) }) },
  "friend-request.accept": { kind: "write", userScope: "dream:write", input: friendRequestInputDto, output: socialDecisionResultDto },
  "friend-request.reject": { kind: "write", userScope: "dream:write", input: friendRequestInputDto, output: socialDecisionResultDto },
  "friendship.list": { kind: "read", userScope: "dream:read", input: empty, output: z.strictObject({ friends: z.array(acceptedFriendDto) }) },
  "friendship.remove": { kind: "write", userScope: "dream:write", input: friendSelectorInputDto, output: socialDecisionResultDto },
  "friendship.timeline": { kind: "read", userScope: "dream:read", input: friendTimelineInputDto, output: z.strictObject({ pictures: z.array(friendPictureDto).nullable() }) },
  "friendship.picture-full": { kind: "read", userScope: "dream:read", input: friendPictureInputDto, output: z.strictObject({ image_base64: z.string().nullable() }) },
} as const;
export type SocialFriendshipOperation = keyof typeof socialFriendshipOperationContracts;
