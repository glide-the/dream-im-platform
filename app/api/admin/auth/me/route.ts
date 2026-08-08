import { adminErrorResponse } from "../../../../lib/admin/errors";
import {
  adminRequestId,
  requireAdminRequest,
} from "../../../../lib/admin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = adminRequestId(request);
  try {
    const identity = await requireAdminRequest(request);
    return Response.json(
      {
        data: {
          id: identity.id,
          email: identity.email,
          name: identity.displayName ?? identity.email,
          roles: identity.roles,
          permissions: identity.permissions,
        },
      },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
