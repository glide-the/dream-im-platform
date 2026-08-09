import { createHash } from "node:crypto";
import { ProductError } from "./errors";
import { productKeyIsForbidden } from "./safety";

export function assertProductDtoSafe(value: unknown, path = "$", seen = new Set<object>()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new ProductError(
      "PRODUCT_RESPONSE_INVALID",
      "The Product API response failed its safety contract",
      503,
    );
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertProductDtoSafe(entry, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (productKeyIsForbidden(key)) {
      throw new ProductError(
        "PRODUCT_RESPONSE_INVALID",
        "The Product API response failed its safety contract",
        503,
        { field: `${path}.${key}` },
      );
    }
    assertProductDtoSafe(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function productEtag(subject: string, data: unknown) {
  assertProductDtoSafe(data);
  const digest = createHash("sha256")
    .update(JSON.stringify(stableValue({ subject, data })))
    .digest("base64url");
  return `\"product-${digest}\"`;
}

export function productSuccessResponse(input: {
  data: unknown;
  requestId: string;
  subject: string;
  request?: Request;
  meta?: Record<string, unknown>;
  status?: number;
  cache?: "revalidate" | "no-store";
}) {
  const etag = productEtag(input.subject, {
    requestUrl: input.request?.url ?? null,
    data: input.data,
    meta: input.meta ?? {},
  });
  const headers = {
    "cache-control":
      input.cache === "no-store"
        ? "no-store"
        : "private, no-cache, max-age=0, must-revalidate",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": input.requestId,
    ...(input.cache === "no-store" ? {} : { etag }),
  };
  if (
    input.request &&
    input.cache !== "no-store" &&
    input.request.headers.get("if-none-match") === etag
  ) {
    return new Response(null, { status: 304, headers });
  }
  const body = {
    data: input.data,
    meta: { ...(input.meta ?? {}), requestId: input.requestId },
  };
  assertProductDtoSafe(body);
  return Response.json(body, {
    status: input.status ?? 200,
    headers,
  });
}
