import { createHash } from "node:crypto";
import { withPlatformClient } from "../platform-db";
import { createPlatformId } from "../platform-ids";

const REDACTED = "[REDACTED]";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "anthropic-auth-token",
  "anthropic_auth_token",
]);
const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "anthropic-beta",
  "anthropic-version",
  "content-encoding",
  "content-length",
  "content-type",
  "idempotency-key",
  "openai-organization",
  "openai-project",
  "user-agent",
  "x-request-id",
]);
const RESPONSE_HEADER_ALLOWLIST = new Set([
  "cache-control",
  "content-type",
  "openai-processing-ms",
  "openai-version",
  "request-id",
  "retry-after",
  "x-request-id",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
]);

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function persistedHeaders(headers: Headers, allowlist: ReadonlySet<string>) {
  const result: Record<string, string> = {};
  headers.forEach((value, originalName) => {
    const name = originalName.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(name)) {
      result[name] = REDACTED;
    } else if (allowlist.has(name)) {
      result[name] = value;
    }
  });
  return result;
}

export function redactRequestHeaders(headers: Headers) {
  return persistedHeaders(headers, REQUEST_HEADER_ALLOWLIST);
}

export function redactResponseHeaders(headers: Headers) {
  return persistedHeaders(headers, RESPONSE_HEADER_ALLOWLIST);
}

export function queryRecord(url: URL) {
  const result: Record<string, string[]> = {};
  url.searchParams.forEach((value, key) => {
    (result[key] ??= []).push(value);
  });
  return result;
}

export type GatewayRequestCapture = {
  request: Request;
  rawBody: string;
  body: unknown;
};

export async function recordGatewayRequestPayload(input: {
  requestId: string;
  capture: GatewayRequestCapture;
  protocol: "anthropic" | "openai";
  requestedModel: string;
  providerProtocol: "anthropic" | "openai";
}) {
  const url = new URL(input.capture.request.url);
  const byteLength = new TextEncoder().encode(input.capture.rawBody).byteLength;
  await withPlatformClient(async (client) => {
    await client.query(
      `INSERT INTO gateway_request_payloads (
         gateway_request_id, method, path, query, protocol, requested_model,
         provider_protocol, headers, body_json, body_text, content_type,
         byte_length, sha256, compression, completion_status
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10,
         $11, $12, $13, 'none', 'complete'
       )
       ON CONFLICT (gateway_request_id) DO NOTHING`,
      [
        input.requestId,
        input.capture.request.method,
        url.pathname,
        JSON.stringify(queryRecord(url)),
        input.protocol,
        input.requestedModel,
        input.providerProtocol,
        JSON.stringify(redactRequestHeaders(input.capture.request.headers)),
        JSON.stringify(input.capture.body),
        input.capture.rawBody,
        input.capture.request.headers.get("content-type"),
        byteLength,
        sha256(input.capture.rawBody),
      ],
    );
    await client.query(
      `UPDATE gateway_requests
       SET payload_capture_status = 'request_captured', payload_capture_error = NULL
       WHERE id = $1`,
      [input.requestId],
    );
  });
}

export async function startGatewayResponsePayload(input: {
  requestId: string;
  status: number;
  headers: Headers;
}) {
  await withPlatformClient(async (client) => {
    await client.query(
      `INSERT INTO gateway_response_payloads (
         gateway_request_id, http_status, content_type, headers,
         completion_status, started_at
       ) VALUES ($1, $2, $3, $4::jsonb, 'streaming', NOW())
       ON CONFLICT (gateway_request_id) DO UPDATE SET
         http_status = EXCLUDED.http_status,
         content_type = EXCLUDED.content_type,
         headers = EXCLUDED.headers,
         completion_status = 'streaming',
         started_at = LEAST(gateway_response_payloads.started_at, NOW())`,
      [
        input.requestId,
        input.status,
        input.headers.get("content-type"),
        JSON.stringify(redactResponseHeaders(input.headers)),
      ],
    );
    await client.query(
      `UPDATE gateway_requests SET payload_capture_status = 'streaming' WHERE id = $1`,
      [input.requestId],
    );
  });
}

export async function recordGatewayJsonResponse(input: {
  requestId: string;
  status: number;
  headers: Headers;
  body: unknown;
  providerRequestId?: string;
  errorBody?: unknown;
}) {
  const bodyText = JSON.stringify(input.body);
  const byteLength = new TextEncoder().encode(bodyText).byteLength;
  await withPlatformClient(async (client) => {
    await client.query(
      `INSERT INTO gateway_response_payloads (
         gateway_request_id, http_status, content_type, headers, body_json,
         body_text, byte_length, sha256, compression, completion_status,
         provider_request_id, error_body, started_at, completed_at
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, 'none', 'complete',
         $9, $10::jsonb, NOW(), NOW()
       )
       ON CONFLICT (gateway_request_id) DO UPDATE SET
         http_status = EXCLUDED.http_status,
         content_type = EXCLUDED.content_type,
         headers = EXCLUDED.headers,
         body_json = EXCLUDED.body_json,
         body_text = EXCLUDED.body_text,
         byte_length = EXCLUDED.byte_length,
         sha256 = EXCLUDED.sha256,
         completion_status = 'complete',
         provider_request_id = EXCLUDED.provider_request_id,
         error_body = EXCLUDED.error_body,
         completed_at = NOW()`,
      [
        input.requestId,
        input.status,
        input.headers.get("content-type") ?? "application/json",
        JSON.stringify(redactResponseHeaders(input.headers)),
        bodyText,
        bodyText,
        byteLength,
        sha256(bodyText),
        input.providerRequestId ?? null,
        input.errorBody === undefined ? null : JSON.stringify(input.errorBody),
      ],
    );
    await client.query(
      `UPDATE gateway_requests
       SET payload_capture_status = 'complete', payload_capture_error = NULL
       WHERE id = $1`,
      [input.requestId],
    );
  });
}

export async function recordGatewayResponseEvent(input: {
  requestId: string;
  sequence: number;
  eventType: string;
  rawData: string;
  rawEvent: string;
  startedAt: number;
}) {
  const byteLength = new TextEncoder().encode(input.rawEvent).byteLength;
  await withPlatformClient(async (client) => {
    await client.query(
      `INSERT INTO gateway_response_events (
         id, gateway_request_id, sequence, event_type, raw_data, raw_event,
         byte_length, elapsed_ms
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (gateway_request_id, sequence) DO NOTHING`,
      [
        createPlatformId("sse"),
        input.requestId,
        input.sequence,
        input.eventType,
        input.rawData,
        input.rawEvent,
        byteLength,
        Math.max(0, Date.now() - input.startedAt),
      ],
    );
    await client.query(
      `UPDATE gateway_response_payloads
       SET byte_length = byte_length + $2,
           first_event_at = COALESCE(first_event_at, NOW())
       WHERE gateway_request_id = $1`,
      [input.requestId, byteLength],
    );
  });
}

export async function completeGatewayStreamPayload(input: {
  requestId: string;
  status: "complete" | "interrupted" | "cancelled" | "failed";
  providerRequestId?: string;
  sha256?: string;
  captureError?: string;
}) {
  await withPlatformClient(async (client) => {
    await client.query(
      `UPDATE gateway_response_payloads
       SET completion_status = $2, provider_request_id = COALESCE($3, provider_request_id),
           sha256 = COALESCE($4, sha256), capture_error = $5, completed_at = NOW()
       WHERE gateway_request_id = $1`,
      [
        input.requestId,
        input.status,
        input.providerRequestId ?? null,
        input.sha256 ?? null,
        input.captureError?.slice(0, 2_000) ?? null,
      ],
    );
    await client.query(
      `UPDATE gateway_requests
       SET payload_capture_status = CASE WHEN $2::text IS NULL THEN 'complete' ELSE 'failed' END,
           payload_capture_error = $2
       WHERE id = $1`,
      [input.requestId, input.captureError?.slice(0, 2_000) ?? null],
    );
  });
}

export async function markGatewayPayloadCaptureFailure(
  requestId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Gateway payload persistence failed";
  await withPlatformClient(async (client) => {
    await client.query(
      `UPDATE gateway_requests
       SET payload_capture_status = 'failed', payload_capture_error = $2
       WHERE id = $1`,
      [requestId, message.slice(0, 2_000)],
    );
  });
}

export function safePayloadWrite(operation: Promise<unknown>, requestId?: string) {
  return operation.catch(async (error) => {
    if (requestId) {
      await markGatewayPayloadCaptureFailure(requestId, error).catch(() => undefined);
    }
    return undefined;
  });
}
