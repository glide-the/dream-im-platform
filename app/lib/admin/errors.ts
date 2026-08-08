import { GatewayError } from "../gateway/errors";

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
