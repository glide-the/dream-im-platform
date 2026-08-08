import { withPlatformTransaction } from "../platform-db";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, requireAdminRequest } from "./guard";

export async function handleGatewayPayloadDetail(
  request: Request,
  gatewayRequestId: string,
) {
  const requestId = adminRequestId(request);
  try {
    const identity = await requireAdminRequest(request, "gateway.payloads.read");
    if (request.headers.get("x-gateway-payload-confirmation") !== "reveal") {
      throw new AdminError(
        "GATEWAY_PAYLOAD_CONFIRMATION_REQUIRED",
        "Viewing full gateway payloads requires an explicit confirmation",
        428,
      );
    }
    const data = await withPlatformTransaction(async (client) => {
      const summary = await client.query<Record<string, unknown>>(
        `SELECT r.id, r.platform_user_id, u.email, r.gateway_api_key_id,
                k.name AS gateway_key_name, k.key_prefix, r.provider_id,
                p.code AS provider_code, p.protocol AS provider_protocol,
                r.model_id, m.code AS model_code, r.requested_model,
                r.resolved_model, r.protocol, r.status, r.outcome,
                r.http_status, r.input_tokens, r.output_tokens,
                r.cache_read_tokens, r.cache_write_tokens,
                r.input_price_snapshot, r.output_price_snapshot,
                r.cache_read_price_snapshot, r.cache_write_price_snapshot,
                r.first_token_ms, r.latency_ms, r.error_code,
                r.error_message, r.created_at, r.started_at,
                r.completed_at, r.settled_at
         FROM gateway_requests r
         JOIN platform_users u ON u.id = r.platform_user_id
         JOIN gateway_api_keys k ON k.id = r.gateway_api_key_id
         JOIN ai_providers p ON p.id = r.provider_id
         JOIN ai_models m ON m.id = r.model_id
         WHERE r.id = $1`,
        [gatewayRequestId],
      );
      if (!summary.rows[0]) {
        throw new AdminError("GATEWAY_REQUEST_NOT_FOUND", "The gateway request does not exist", 404);
      }
      const requestPayload = await client.query<Record<string, unknown>>(
        `SELECT method, path, query, protocol, requested_model,
                provider_protocol, headers, body_json, body_text,
                content_type, byte_length, sha256, compression,
                completion_status, capture_error, captured_at
         FROM gateway_request_payloads
         WHERE gateway_request_id = $1`,
        [gatewayRequestId],
      );
      const responsePayload = await client.query<Record<string, unknown>>(
        `SELECT http_status, content_type, headers, body_json, body_text,
                byte_length, sha256, compression, completion_status,
                provider_request_id, error_body, capture_error, started_at,
                first_event_at, completed_at
         FROM gateway_response_payloads
         WHERE gateway_request_id = $1`,
        [gatewayRequestId],
      );
      const events = await client.query<Record<string, unknown>>(
        `SELECT sequence, event_type, raw_data, raw_event, byte_length,
                elapsed_ms, emitted_at
         FROM gateway_response_events
         WHERE gateway_request_id = $1
         ORDER BY sequence ASC`,
        [gatewayRequestId],
      );
      await recordAdminAuditOnClient(client, {
        identity,
        action: "view_full_payload",
        resourceType: "gateway_request_payload",
        resourceId: gatewayRequestId,
        requestId,
        request,
        metadata: {
          requestPayloadAvailable: Boolean(requestPayload.rows[0]),
          responsePayloadAvailable: Boolean(responsePayload.rows[0]),
          eventCount: events.rowCount ?? 0,
        },
      });
      return {
        summary: summary.rows[0],
        request: requestPayload.rows[0] ?? null,
        response: responsePayload.rows[0] ?? null,
        events: events.rows,
        rawSse: events.rows.map((event) => String(event.raw_event)).join(""),
      };
    });
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store, private", "x-request-id": requestId, "x-content-type-options": "nosniff" } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
