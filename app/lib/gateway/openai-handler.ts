import { prepareGatewayRequest, preparationErrorResponse } from "./prepare";
import { openAIChatCompletionSchema } from "./protocols";
import { estimateJsonTokens, parseGatewayJsonCapture, readIdempotencyKey } from "./request-body";
import { gatewayProtocolErrorResponse, proxyNonStreaming, proxyStreaming } from "./proxy-handler";

export async function handleOpenAIChatCompletions(request: Request) {
  try {
    const captured = await parseGatewayJsonCapture(request, openAIChatCompletionSchema);
    const body = captured.data;
    const requestedMaxOutputTokens = body.max_completion_tokens ?? body.max_tokens ?? undefined;
    const result = await prepareGatewayRequest({
      headers: request.headers,
      requiredScope: "chat:create",
      protocol: "openai",
      requestedModel: body.model,
      isStreaming: body.stream,
      idempotencyKey: readIdempotencyKey(request.headers),
      estimatedInputTokens: estimateJsonTokens({ messages: body.messages, tools: body.tools, response_format: body.response_format }),
      requestedMaxOutputTokens,
      outputChoices: body.n ?? 1,
      requestCapture: { request, rawBody: captured.rawBody, body: captured.body },
    });
    if (result.kind !== "ready") return await preparationErrorResponse(result, "openai");
    const input = { request, externalProtocol: "openai" as const, prepared: result.value, body };
    return body.stream ? await proxyStreaming(input) : await proxyNonStreaming(input);
  } catch (error) {
    return gatewayProtocolErrorResponse("openai", error);
  }
}
