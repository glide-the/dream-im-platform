export type GatewayErrorType =
  | "authentication_error"
  | "permission_error"
  | "billing_error"
  | "rate_limit_error"
  | "invalid_request_error"
  | "upstream_error"
  | "configuration_error"
  | "internal_error";

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly type: GatewayErrorType,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export function toGatewayError(error: unknown) {
  if (error instanceof GatewayError) return error;
  return new GatewayError(
    "INTERNAL_ERROR",
    "The gateway could not complete the request",
    500,
    "internal_error",
    true,
  );
}

export function gatewayErrorResponse(error: unknown, requestId?: string) {
  const resolved = toGatewayError(error);
  return Response.json(
    {
      error: {
        type: resolved.type,
        code: resolved.code,
        message: resolved.message,
        request_id: requestId,
      },
    },
    {
      status: resolved.status,
      headers: {
        ...(requestId ? { "x-request-id": requestId } : {}),
        ...(resolved.retryable ? { "retry-after": "1" } : {}),
      },
    },
  );
}
