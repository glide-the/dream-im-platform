// [Input] Strict internal creation request or public opaque bearer renewal/revocation request.
// [Output] Entity-limited DTO; runtime needs only its delegation and Admin endpoint.
// [Pos] Delegation ingress; all identity/entity/receipt persistence stays in Admin domain UOW.
// [Sync] 2026-09-16: exchange server-only Reflections authority only through the source-fenced DTO path.
// [Sync] 2026-09-14: public bearer actions never consume cookies or service secrets.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "./config";
import { delegationCreateRequestDto, delegationActionRequestDto, delegationTokenDto, delegationRenewOutputDto, delegationRevokeOutputDto, delegationReceiptInputDto } from "./delegationDto";
import { handleInternalAuthRequest, parseAuthDto } from "./internalHandler";
import { withDataTransaction } from "../dream/database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, runtimeReflectionAuthoritySchemaRequirement } from "../dream/schemaRequirements";
import { DelegationService } from "./delegationService";
import { dreamUnifiedSchemaRequirement } from "../dream/chatThreadService";
const requirements = [identitySchemaRequirement, runtimeDelegationSchemaRequirement,
  runtimePurposeSchemaRequirement, runtimeReflectionAuthoritySchemaRequirement];
export async function handleDelegationCreate(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, delegationCreateRequestDto); setRequestId(input.request_id);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const reflectionAuthority = bearer.startsWith("rta_");
    return withDataTransaction([
      ...requirements, dreamUnifiedSchemaRequirement,
      ...(reflectionAuthority ? [reflectionTaskSchemaRequirement] : []),
    ], tx => reflectionAuthority
      ? new DelegationService(tx).createForReflectionAuthority(
        service, bearer, input.request_id, input.input,
      )
      : new DelegationService(tx).create(
        service, request.headers, input.request_id, input.input,
      ));
  });
}
async function handleBearerAction(request: Request, action: "renew" | "revoke") {
  let requestId = `runtime_${randomUUID().replaceAll("-", "")}`;
  const headers = { "Cache-Control": "no-store" };
  try {
    const input = await parseAuthDto(request, delegationActionRequestDto); requestId = input.request_id;
    const match = request.headers.get("authorization")?.match(/^Bearer (idg_[A-Za-z0-9_-]{43})$/);
    if (request.headers.has("cookie") || !match || !delegationTokenDto.safeParse(match[1]).success) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const data = action === "renew"
      ? await withDataTransaction(requirements, tx => new DelegationService(tx).renew(match[1], requestId))
      : await withDataTransaction(requirements, tx => new DelegationService(tx).revoke(match[1], requestId));
    return Response.json({ data: action === "renew" ? delegationRenewOutputDto.parse(data) : delegationRevokeOutputDto.parse(data), request_id: requestId }, { headers });
  } catch (error) {
    return Response.json({ error: { code: error instanceof AuthBoundaryError ? error.code : "DELEGATION_UNAVAILABLE", message: "The runtime delegation request could not be completed." }, request_id: requestId }, { status: error instanceof AuthBoundaryError ? error.status : 503, headers });
  }
}
export const handleDelegationRenew = (request: Request) => handleBearerAction(request, "renew");
export const handleDelegationRevoke = (request: Request) => handleBearerAction(request, "revoke");
export async function handleDelegationReceipt(request: Request, requestId: string) {
  const headers = { "Cache-Control": "no-store" };
  let safeRequestId = `runtime_${randomUUID().replaceAll("-", "")}`;
  try {
    const query = new URL(request.url).searchParams;
    const input = delegationReceiptInputDto.safeParse({ request_id: requestId, operation: query.get("operation") });
    if (!input.success || query.size !== 1) throw new AuthBoundaryError("INPUT_INVALID", 400);
    safeRequestId = input.data.request_id;
    const token = request.headers.get("authorization")?.match(/^Bearer (idg_[A-Za-z0-9_-]{43})$/)?.[1];
    if (request.headers.has("cookie") || !token) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const data = await withDataTransaction(requirements, tx => new DelegationService(tx).receipt(token, input.data.operation, input.data.request_id));
    return Response.json({ data, request_id: input.data.request_id }, { headers });
  } catch (error) {
    return Response.json({ error: { code: error instanceof AuthBoundaryError ? error.code : "DELEGATION_UNAVAILABLE", message: "The runtime delegation receipt could not be read." }, request_id: safeRequestId }, { status: error instanceof AuthBoundaryError ? error.status : 503, headers });
  }
}
