// [Input] Owned thread/run reference and explicitly requested subset of user-granted scopes.
// [Output] Strict entity-limited delegation and renewal DTOs, independent of ORM storage.
// [Pos] Long-turn/runtime protocol; no global credential, arbitrary actor or new identity authority.
// [Sync] 2026-09-14: separate server/CLI/Editor purposes and bind Editor to its actual Session.
import { z } from "zod";
import { requestIdDto, isoTimeDto } from "./dto";
export const delegationPurposeScopes = {
  "server-persistence": ["dream:read", "dream:write"],
  "gateway-cli": ["messages:create", "messages:count_tokens", "models:list"],
  "editor-stdio": ["editor:read", "editor:write"],
} as const;
export const delegationPurposeDto = z.enum(["server-persistence", "gateway-cli", "editor-stdio"]);
export const runtimeScopeDto = z.enum(["dream:read", "dream:write", "messages:create", "messages:count_tokens", "models:list", "editor:read", "editor:write"]);
export const delegationTokenDto = z.string().regex(/^idg_[A-Za-z0-9_-]{43}$/);
export const delegationCreateInputDto = z.strictObject({ purpose: delegationPurposeDto, thread_id: z.string().min(1), run_id: z.string().min(1).nullable(), editor_session_id: z.string().min(1).nullable(), scopes: z.array(runtimeScopeDto).min(1) });
export function validDelegationPurpose(input: { purpose: string | null; scopes: string[]; editorSessionId: string | null; gatewayApiKeyId?: string | null }) {
  if (!delegationPurposeDto.safeParse(input.purpose).success || !input.scopes.length || new Set(input.scopes).size !== input.scopes.length) return false;
  const purpose = input.purpose as z.infer<typeof delegationPurposeDto>;
  if (input.scopes.some(scope => !(delegationPurposeScopes[purpose] as readonly string[]).includes(scope))) return false;
  if ((purpose === "editor-stdio") !== (input.editorSessionId !== null)) return false;
  if (input.gatewayApiKeyId !== undefined && (purpose === "gateway-cli") !== (input.gatewayApiKeyId !== null)) return false;
  return true;
}
export const delegationCreateRequestDto = z.strictObject({ request_id: requestIdDto, input: delegationCreateInputDto });
export const delegationOutputDto = z.strictObject({ token: delegationTokenDto, expires_at: isoTimeDto, maximum_expires_at: isoTimeDto, purpose: delegationPurposeDto, thread_id: z.string(), run_id: z.string().nullable(), editor_session_id: z.string().nullable(), scopes: z.array(runtimeScopeDto) });
export const delegationActionRequestDto = z.strictObject({ request_id: requestIdDto });
export const delegationRenewOutputDto = delegationOutputDto.omit({ token: true });
export const delegationRevokeOutputDto = z.strictObject({ revoked: z.literal(true) });
export const delegationReceiptOperationDto = z.enum(["runtime-delegation.renew", "runtime-delegation.revoke"]);
export const delegationReceiptInputDto = z.strictObject({ request_id: requestIdDto, operation: delegationReceiptOperationDto });
export function delegationReceiptOutputDto(operation: z.infer<typeof delegationReceiptOperationDto>) {
  return z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("absent"), operation: z.literal(operation), request_id: requestIdDto }),
    z.strictObject({ status: z.literal("committed"), operation: z.literal(operation), request_id: requestIdDto, result: operation === "runtime-delegation.renew" ? delegationRenewOutputDto : delegationRevokeOutputDto }),
  ]);
}
