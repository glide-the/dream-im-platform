// [Input] Public Gateway JSON bodies, idempotency headers, and configured body capacity.
// [Output] Strict parsed DTOs and stable request fingerprints without unbounded buffering.
// [Pos] Shared Gateway request-body boundary used before model resolution and Provider dispatch.
// [Sync] 2026-10-09: stream-cap every JSON request before decoding so chunked bodies cannot bypass the limit.

import { createHash } from "node:crypto";
import { z } from "zod";
import { GatewayError } from "./errors";
import { BodyLimitExceededError, readLimitedBody } from "./read-limited-body";

const DEFAULT_MAX_BODY_BYTES = 20 * 1024 * 1024;

function configuredMaxBodyBytes() {
  const raw = process.env.GATEWAY_MAX_BODY_BYTES;
  if (!raw) return DEFAULT_MAX_BODY_BYTES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1_024) {
    throw new GatewayError(
      "GATEWAY_BODY_LIMIT_INVALID",
      "GATEWAY_MAX_BODY_BYTES must be a positive integer of at least 1024",
      503,
      "configuration_error",
    );
  }
  return parsed;
}

export async function parseGatewayJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  return (await parseGatewayJsonCapture(request, schema)).data;
}

export async function parseGatewayJsonCapture<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; rawBody: string; body: unknown }> {
  const maxBytes = configuredMaxBodyBytes();
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody({
      body: request.body,
      declaredLength: request.headers.get("content-length"),
      maxBytes,
    });
  } catch (error) {
    if (!(error instanceof BodyLimitExceededError)) throw error;
    throw new GatewayError(
      "REQUEST_BODY_TOO_LARGE",
      `The request body exceeds the ${maxBytes} byte limit`,
      413,
      "invalid_request_error",
    );
  }
  const text = new TextDecoder().decode(bytes);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GatewayError(
      "INVALID_JSON",
      "The request body must contain valid JSON",
      400,
      "invalid_request_error",
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GatewayError(
      "INVALID_REQUEST",
      parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; "),
      400,
      "invalid_request_error",
    );
  }
  return { data: parsed.data, rawBody: text, body: json };
}

export function estimateJsonTokens(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  return Math.max(1, Math.ceil(bytes / 3));
}

export function readIdempotencyKey(headers: Headers) {
  const value = headers.get("idempotency-key")?.trim();
  if (!value) return undefined;
  if (value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new GatewayError(
      "IDEMPOTENCY_KEY_INVALID",
      "Idempotency-Key must be 1-128 URL-safe characters",
      400,
      "invalid_request_error",
    );
  }
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Resolve the reservation key for a provider request.
 *
 * Claude Code accepts only static custom headers for a whole Agent turn, but
 * a tool loop performs a new provider request after every tool result. Dream
 * therefore supplies a stable turn root and the Gateway, which owns billing
 * idempotency, derives the request key from that root and the exact captured
 * body. Exact retries reuse one key; a changed tool-result body gets a new
 * reservation. Direct Idempotency-Key clients retain their existing contract.
 */
export function deriveGatewayIdempotencyKey(
  headers: Headers,
  rawBody: string,
) {
  const direct = readIdempotencyKey(headers);
  const turnRoot = headers.get("x-ink-turn-idempotency-key")?.trim();
  if (!turnRoot) return direct;
  if (direct) {
    throw new GatewayError(
      "IDEMPOTENCY_HEADER_CONFLICT",
      "Use either Idempotency-Key or X-Ink-Turn-Idempotency-Key, not both",
      400,
      "invalid_request_error",
    );
  }
  if (turnRoot.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(turnRoot)) {
    throw new GatewayError(
      "TURN_IDEMPOTENCY_KEY_INVALID",
      "X-Ink-Turn-Idempotency-Key must be 1-128 URL-safe characters",
      400,
      "invalid_request_error",
    );
  }
  return `turn-${sha256(turnRoot).slice(0, 24)}-request-${sha256(rawBody)}`;
}
