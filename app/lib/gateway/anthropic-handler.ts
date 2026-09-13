// [Input] Public Anthropic Messages/count requests and the authenticated model route.
// [Output] Compatible responses with protocol-aware reservation/count estimates.
// [Pos] Anthropic Gateway orchestration; provider transport and settlement remain shared.
// [Sync] 2026-09-13: estimate image blocks independently from base64 JSON byte length.

import type { MessageCountTokensParams } from "@anthropic-ai/sdk/resources/messages";
import { authenticateGatewayRequest } from "./auth";
import { gatewayErrorResponse, toGatewayError } from "./errors";
import { prepareGatewayRequest, preparationErrorResponse } from "./prepare";
import { createAnthropicProviderClient, toProviderGatewayError } from "./provider-clients";
import { anthropicCountTokensSchema, anthropicMessageSchema } from "./protocols";
import { deriveGatewayIdempotencyKey, parseGatewayJson, parseGatewayJsonCapture } from "./request-body";
import { estimateInputTokens } from "./input-token-estimate";
import { gatewayProtocolErrorResponse, proxyNonStreaming, proxyStreaming } from "./proxy-handler";
import { resolveBillableModel } from "../models/resolver";

export async function handleAnthropicMessages(request: Request) {
  try {
    const captured = await parseGatewayJsonCapture(request, anthropicMessageSchema);
    const body = captured.data;
    const result = await prepareGatewayRequest({
      headers: request.headers,
      requiredScope: "messages:create",
      protocol: "anthropic",
      requestedModel: body.model,
      isStreaming: body.stream,
      idempotencyKey: deriveGatewayIdempotencyKey(request.headers, captured.rawBody),
      estimatedInputTokens: (providerProtocol) => estimateInputTokens("anthropic", { messages: body.messages, system: body.system, tools: body.tools }, providerProtocol),
      requestedMaxOutputTokens: body.max_tokens,
      requestCapture: { request, rawBody: captured.rawBody, body: captured.body },
    });
    if (result.kind !== "ready") return await preparationErrorResponse(result, "anthropic");
    const input = { request, externalProtocol: "anthropic" as const, prepared: result.value, body };
    return body.stream ? await proxyStreaming(input) : await proxyNonStreaming(input);
  } catch (error) {
    return gatewayProtocolErrorResponse("anthropic", error);
  }
}

export async function handleAnthropicCountTokens(request: Request) {
  try {
    const body = await parseGatewayJson(request, anthropicCountTokensSchema);
    const principal = await authenticateGatewayRequest(request.headers, "messages:create");
    const resolved = await resolveBillableModel({ platformUserId: principal.platformUserId, requestedModel: body.model, protocol: "anthropic" });
    if (resolved.provider.protocol === "openai") {
      return Response.json({ input_tokens: estimateInputTokens("anthropic", { messages: body.messages, system: body.system, tools: body.tools }, "openai") }, { headers: { "cache-control": "no-store" } });
    }
    const client = createAnthropicProviderClient(resolved);
    const response = await client.messages.countTokens({ ...body, model: resolved.model.upstreamModel } as unknown as MessageCountTokensParams, { signal: request.signal });
    return Response.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return gatewayErrorResponse(toProviderGatewayError(error));
  }
}
