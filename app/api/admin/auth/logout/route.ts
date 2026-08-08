import { adminErrorResponse } from "../../../../lib/admin/errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
} from "../../../../lib/admin/guard";
import {
  ADMIN_SESSION_COOKIE,
  clearedAdminSessionCookie,
  parseCookie,
  revokeAdminSession,
} from "../../../../lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await revokeAdminSession(
      parseCookie(request.headers, ADMIN_SESSION_COOKIE),
    );
    return Response.json(
      { data: { loggedOut: true } },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": clearedAdminSessionCookie(),
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
