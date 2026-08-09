import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { idempotencyKeySchema } from "./contracts";
import { ProductError } from "./errors";

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const identityHeaders = [
  "x-user-id",
  "x-canonical-user-id",
  "x-platform-user-id",
  "x-external-user-id",
] as const;

export function productRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && requestIdPattern.test(supplied)
    ? supplied
    : `product_${randomUUID().replaceAll("-", "")}`;
}

export function assertNoProductUserOverride(request: Request) {
  if (identityHeaders.some((header) => request.headers.has(header))) {
    throw new ProductError(
      "PRODUCT_USER_OVERRIDE_DENIED",
      "Product user identity must come only from the authenticated subject",
      400,
    );
  }
}

function configuredOrigins() {
  const raw = process.env.PRODUCT_API_ORIGIN_ALLOWLIST;
  if (!raw?.trim()) return [];
  return raw.split(",").map((entry) => {
    const candidate = entry.trim();
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new ProductError(
        "PRODUCT_CONFIGURATION_INVALID",
        "The Product API origin allowlist is invalid",
        503,
      );
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== candidate ||
      parsed.username ||
      parsed.password
    ) {
      throw new ProductError(
        "PRODUCT_CONFIGURATION_INVALID",
        "The Product API origin allowlist is invalid",
        503,
      );
    }
    return parsed.origin;
  });
}

export function assertProductOrigin(request: Request, required: boolean) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (required) {
      throw new ProductError(
        "PRODUCT_ORIGIN_REQUIRED",
        "An allowed Origin is required for this request",
        403,
      );
    }
    return;
  }
  const allowlist = configuredOrigins();
  if (!allowlist.includes(origin)) {
    throw new ProductError(
      "PRODUCT_ORIGIN_DENIED",
      "The request Origin is not allowed",
      403,
    );
  }
}

export function parseStrictQuery<T extends z.ZodType>(
  request: Request,
  schema: T,
): z.output<T> {
  const query = new URL(request.url).searchParams;
  const value: Record<string, string> = {};
  for (const key of new Set(query.keys())) {
    const entries = query.getAll(key);
    if (entries.length !== 1) {
      throw new ProductError(
        "PRODUCT_INPUT_INVALID",
        "Query parameters must not be repeated",
        400,
        { field: key },
      );
    }
    value[key] = entries[0] ?? "";
  }
  return schema.parse(value);
}

export async function parseStrictJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new ProductError(
      "PRODUCT_JSON_REQUIRED",
      "The request body must use application/json",
      415,
    );
  }
  const declared = request.headers.get("content-length");
  if (declared && !/^\d+$/.test(declared)) {
    throw new ProductError(
      "PRODUCT_INPUT_INVALID",
      "The Product API Content-Length is invalid",
      400,
      { field: "content-length" },
    );
  }
  if (declared && Number(declared) > 16_384) {
    throw new ProductError(
      "PRODUCT_BODY_TOO_LARGE",
      "The Product API request body is too large",
      413,
    );
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) {
    throw new ProductError(
      "PRODUCT_BODY_TOO_LARGE",
      "The Product API request body is too large",
      413,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProductError(
      "PRODUCT_JSON_INVALID",
      "The request body must contain valid JSON",
      400,
    );
  }
  return schema.parse(value);
}

export function productIdempotencyKey(request: Request, required: boolean) {
  const value = request.headers.get("idempotency-key");
  if (!value) {
    if (required) {
      throw new ProductError(
        "PRODUCT_IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key is required for command execution",
        400,
      );
    }
    return undefined;
  }
  if (!required) {
    throw new ProductError(
      "PRODUCT_IDEMPOTENCY_KEY_NOT_ALLOWED",
      "Idempotency-Key is allowed only for command execution",
      400,
    );
  }
  return idempotencyKeySchema.parse(value);
}
