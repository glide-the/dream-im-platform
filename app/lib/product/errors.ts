import { z } from "zod";
import { productKeyIsForbidden } from "./safety";

export class ProductError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ProductError";
  }
}

function safeZodIssues(error: z.ZodError) {
  return error.issues.slice(0, 8).map((issue) => ({
    code: issue.code,
    path: issue.path.map(String),
    message: issue.message,
  }));
}

function errorDetailsAreSafe(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value)) return false;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  for (const [key, entry] of entries) {
    if (
      productKeyIsForbidden(key) ||
      !errorDetailsAreSafe(entry, seen)
    ) {
      return false;
    }
  }
  seen.delete(value);
  return true;
}

export function asProductError(error: unknown) {
  if (error instanceof ProductError) return error;
  if (error instanceof z.ZodError) {
    return new ProductError(
      "PRODUCT_INPUT_INVALID",
      "The Product API input is invalid",
      400,
      { issues: safeZodIssues(error) },
    );
  }
  return new ProductError(
    "PRODUCT_DEPENDENCY_UNAVAILABLE",
    "The Product API cannot safely complete the request",
    503,
  );
}

export function productErrorResponse(error: unknown, requestId: string) {
  const productError = asProductError(error);
  const details = errorDetailsAreSafe(productError.details)
    ? productError.details
    : undefined;
  const body = {
    error: {
      code: productError.code,
      message: productError.message,
      ...(details === undefined ? {} : { details }),
    },
    meta: {
      requestId,
      ...(productError.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: productError.retryAfterSeconds }),
    },
  };
  return Response.json(body, {
    status: productError.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
      ...(productError.retryAfterSeconds === undefined
        ? {}
        : { "retry-after": String(productError.retryAfterSeconds) }),
    },
  });
}
