import { z } from "zod";
import {
  bootstrapFirstAdmin,
  isAdminBootstrapRequired,
} from "../../../../lib/admin/bootstrap";
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
import { ADMIN_PASSWORD_MIN_LENGTH } from "../../../../lib/admin/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootstrapSchema = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(256),
});

export async function GET(request: Request) {
  const requestId = adminRequestId(request);
  try {
    const required = await isAdminBootstrapRequired();
    return Response.json(
      { data: { required } },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch {
    return adminErrorResponse(
      new AdminError(
        "ADMIN_BOOTSTRAP_STATUS_UNAVAILABLE",
        "无法读取管理员初始化状态，请确认 PostgreSQL 已启动并完成迁移",
        503,
      ),
      requestId,
    );
  }
}

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
        `A valid email, display name, and password of at least ${ADMIN_PASSWORD_MIN_LENGTH} characters are required`,
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
