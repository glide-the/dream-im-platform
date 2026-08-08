import { z } from "zod";
import { bootstrapFirstAdmin } from "../../../../lib/admin/bootstrap";
import { AdminError, adminErrorResponse } from "../../../../lib/admin/errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
} from "../../../../lib/admin/guard";
import {
  adminSessionCookie,
  createAdminSession,
  verifyBootstrapToken,
} from "../../../../lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootstrapSchema = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(14).max(256),
});

export async function POST(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    if (!verifyBootstrapToken(request.headers.get("x-admin-bootstrap-token"))) {
      throw new AdminError(
        "ADMIN_BOOTSTRAP_DENIED",
        "Admin bootstrap is not available",
        403,
      );
    }
    const parsed = bootstrapSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AdminError(
        "ADMIN_BOOTSTRAP_INVALID",
        "A valid email, display name, and strong password are required",
        400,
      );
    }
    const result = await bootstrapFirstAdmin({
      ...parsed.data,
      request,
      requestId,
    });
    const session = await createAdminSession(result.adminUserId);
    return Response.json(
      { data: { id: result.adminUserId, email: parsed.data.email } },
      {
        status: 201,
        headers: {
          "cache-control": "no-store",
          "set-cookie": adminSessionCookie(session.token, session.expiresAt),
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
