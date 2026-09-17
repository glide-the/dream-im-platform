// [Input] Independent Admin Session/RBAC, same-origin JSON, canonical Dream user id, and role-transition DTO.
// [Output] Audited product-role mutation response with one PostgreSQL transaction for row update and audit.
// [Pos] Thin HTTP orchestration over DTO-Service-Drizzle; it cannot create Admin members or auth subject links.
// [Sync] 2026-09-17: expose explicit Dream product-role administration through the Admin control plane.
import { z } from "zod";
import { withPlatformTransaction } from "../platform-db";
import { recordAdminAuditOnClient } from "./audit";
import {
  dreamCanonicalUserIdDto,
  dreamUserRoleMutationDto,
  dreamUserRoleMutationResultDto,
} from "./dream-user-role-dto";
import { DrizzleDreamUserRoleRepository } from "./dream-user-role-repository";
import { DreamUserRoleService } from "./dream-user-role-service";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

const MAX_BODY_BYTES = 8_192;

async function parseBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AdminError(
      "ADMIN_INPUT_INVALID",
      "Content-Type application/json is required",
      400,
    );
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AdminError("ADMIN_INPUT_TOO_LARGE", "Request body is too large", 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new AdminError("ADMIN_INPUT_TOO_LARGE", "Request body is too large", 413);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AdminError("ADMIN_INPUT_INVALID", "Request body must be valid JSON", 400);
  }
  const parsed = dreamUserRoleMutationDto.safeParse(value);
  if (!parsed.success) {
    throw new AdminError(
      "ADMIN_INPUT_INVALID",
      "Dream product role input is invalid",
      400,
      z.flattenError(parsed.error),
    );
  }
  return parsed.data;
}

export async function handleDreamUserRoleAction(
  request: Request,
  canonicalUserIdInput: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "users.write");
    const canonicalUserId = dreamCanonicalUserIdDto.parse(canonicalUserIdInput);
    const input = await parseBody(request);
    const result = await withPlatformTransaction(async (client) => {
      const service = new DreamUserRoleService(
        new DrizzleDreamUserRoleRepository(client),
      );
      const transition = await service.setRole(canonicalUserId, input);
      await recordAdminAuditOnClient(client, {
        identity,
        action: "dream-user.product-role.set",
        resourceType: "dream-user",
        resourceId: canonicalUserId,
        requestId,
        request,
        before: { role: transition.before.role },
        after: { role: transition.after.role },
        metadata: {
          reason: input.reason,
          expectedRole: input.expectedRole,
          idempotent: transition.idempotent,
          adminMembershipChanged: false,
          authSubjectChanged: false,
        },
      });
      return dreamUserRoleMutationResultDto.parse({
        user: transition.after,
        idempotent: transition.idempotent,
      });
    });
    return Response.json(
      { data: result },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    const resolved = error instanceof z.ZodError
      ? new AdminError(
          "ADMIN_INPUT_INVALID",
          "Canonical Dream user id is invalid",
          400,
          z.flattenError(error),
        )
      : error;
    return adminErrorResponse(resolved, requestId);
  }
}
