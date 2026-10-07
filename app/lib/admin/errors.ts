// [Input] Typed Admin/Gateway failures and shared PostgreSQL readiness failures.
// [Output] Safe HTTP errors with an actionable schema-unavailable 503 and a redacted unknown-failure 500.
// [Pos] Admin response boundary; never exposes SQL, credentials or unknown exception messages.
// [Sync] 2026-10-06: preserve missing migration readiness instead of hiding it as a generic internal failure.
import { GatewayError } from "../gateway/errors";
import { PlatformSchemaNotReadyError } from "../platform-db";

export class AdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export function adminErrorResponse(error: unknown, requestId?: string) {
  const resolved =
    error instanceof AdminError
      ? error
      : error instanceof GatewayError
        ? new AdminError(error.code, error.message, error.status)
      : error instanceof PlatformSchemaNotReadyError
        ? new AdminError(
            error.code,
            "数据库版本尚未更新，请先完成显式数据库迁移后再使用管理后台。",
            503,
          )
      : new AdminError(
          "ADMIN_INTERNAL_ERROR",
          "The admin service could not complete the request",
          500,
        );
  return Response.json(
    {
      error: {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.details === undefined
          ? {}
          : { details: resolved.details }),
        requestId,
      },
    },
    {
      status: resolved.status,
      headers: {
        "cache-control": "no-store",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
    },
  );
}
