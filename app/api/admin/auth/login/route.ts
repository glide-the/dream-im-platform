import { z } from "zod";
import { AdminError, adminErrorResponse } from "../../../../lib/admin/errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
} from "../../../../lib/admin/guard";
import { verifyAdminLogin } from "../../../../lib/admin/login";
import {
  adminSessionCookie,
  createAdminSession,
} from "../../../../lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return adminErrorResponse(
        new AdminError(
          "ADMIN_LOGIN_INVALID",
          "A valid email and password are required",
          400,
        ),
        requestId,
      );
    }
    const user = await verifyAdminLogin({
      ...parsed.data,
      request,
      requestId,
    });
    const session = await createAdminSession(user.id);
    return Response.json(
      { data: user },
      {
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
