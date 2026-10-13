// [Input] One stored-Provider Responses verification response, its deadline and credential headers.
// [Output] Full-image validation with safe real identities or fixed failure categories, without response content.
// [Pos] Admin model-validation result reader; never publishes model capability or creates Gateway requests.
// [Sync] 2026-10-11: reuse bounded image decoding and Responses state for actual hosted generation verification.
import { imageApiPolicy } from "../../../config/image-api-policy";
import { redactProviderErrorBody } from "../gateway/payloads";
import { readLimitedBody, BodyLimitExceededError } from "../gateway/read-limited-body";
import { ResponsesStreamResponseState } from "../gateway/responses-adapter";
import { parseResponsesImageOutput } from "../gateway/responses-image-protocol";
import { parseSseStream } from "../gateway/sse";
import type { ModelValidationResult } from "./model-validation";

export const responsesImageValidationKind = "responses_image_generation" as const;
export const responsesImageValidationPrompt = "Generate exactly one simple image: a blue circle on a plain white background.";
const safeErrorValues = new Set(["invalid_request_error", "unsupported_tool", "unsupported_value", "invalid_value", "model_not_found", "rate_limit_exceeded", "insufficient_quota", "authentication_error", "permission_error"]);

export type ResponsesImageValidationSummary = {
  responseId: string;
  imageCalls: Awaited<ReturnType<typeof parseResponsesImageOutput>>["imageCalls"];
};

function safeIdentity(value: string | null, credentialHeaders: Headers) {
  if (!value || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) return undefined;
  return redactProviderErrorBody(value, [credentialHeaders]) === value ? value : undefined;
}

export async function readResponsesImageValidation(input: {
  response: Pick<Response, "status"> & Partial<Pick<Response, "headers" | "body">>;
  adapterKind: string;
  credentialHeaders: Headers;
  signal: AbortSignal;
}): Promise<Pick<ModelValidationResult, "status" | "usable" | "message" | "validationKind" | "failureCode" | "upstreamErrorCode" | "upstreamErrorType" | "upstreamRequestId" | "imageSummary">> {
  const { response, signal } = input;
  const common = {
    validationKind: responsesImageValidationKind,
    upstreamRequestId: safeIdentity(response.headers?.get("request-id") ?? response.headers?.get("x-request-id") ?? null, input.credentialHeaders),
  };
  try {
    const bytes = await readLimitedBody({ body: response.body ?? null,
      declaredLength: response.headers?.get("content-length"), maxBytes: imageApiPolicy.maxResponseBytes, signal });
    if (response.status < 200 || response.status >= 300) {
      let error: Record<string, unknown> = {};
      try { const body = JSON.parse(new TextDecoder().decode(bytes)); error = body?.error ?? {}; } catch { /* no free-text diagnostics */ }
      const degraded = response.status === 408 || response.status === 429 || response.status >= 500;
      return { ...common, status: degraded ? "degraded" : "failed", usable: false,
        failureCode: "RESPONSES_IMAGE_UPSTREAM_REJECTED",
        message: degraded ? "图片核实暂未完成；请稍后自主重试。" : "上游未接受本次 Responses 图片生成请求；请核对 Provider 与模型支持。",
        ...(typeof error.code === "string" && safeErrorValues.has(error.code) ? { upstreamErrorCode: error.code } : {}),
        ...(typeof error.type === "string" && safeErrorValues.has(error.type) ? { upstreamErrorType: error.type } : {}) };
    }
    const contentType = response.headers?.get("content-type")?.trim().toLowerCase() ?? "";
    const eventStream = contentType.includes("text/event-stream")
      || (input.adapterKind === "codex" && contentType.length === 0 && response.body != null);
    let value: unknown;
    const observedImageCalls = new Map<string, number>();
    const observedIndexes = new Map<number, string>();
    if (eventStream) {
      const state = new ResponsesStreamResponseState();
      for await (const event of parseSseStream(new Response(bytes).body!, signal)) {
        if (event.data === "[DONE]") break;
        const item: Record<string, unknown> = JSON.parse(event.data);
        if (item.type === "response.output_item.added" || item.type === "response.output_item.done") {
          const snapshot = item.item as Record<string, unknown> | undefined;
          if (snapshot?.type === "image_generation_call") {
            const index = item.output_index;
            if (typeof snapshot.id !== "string" || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0
              || (observedImageCalls.has(snapshot.id) && observedImageCalls.get(snapshot.id) !== index)
              || (observedIndexes.has(index) && observedIndexes.get(index) !== snapshot.id)) throw new Error("INVALID_IMAGE_CALL_IDENTITY");
            observedImageCalls.set(snapshot.id, index);
            observedIndexes.set(index, snapshot.id);
          }
        }
        const terminal = state.push(item);
        if (terminal) {
          if (value !== undefined) throw new Error("DUPLICATE_TERMINAL");
          value = terminal;
        }
      }
    } else value = JSON.parse(new TextDecoder().decode(bytes));
    signal.throwIfAborted();
    const output = await parseResponsesImageOutput(value, { operation: "generate", maxOutputImages: 1 });
    signal.throwIfAborted();
    if (!safeIdentity(output.responseId, input.credentialHeaders)
      || output.imageCalls.some(call => !safeIdentity(call.callId, input.credentialHeaders))) throw new Error("PRIVATE_IMAGE_IDENTITY");
    if (observedImageCalls.size > 1 || [...observedImageCalls].some(([id, index]) => id !== output.imageCalls[0].callId || index !== output.imageCalls[0].outputIndex)) throw new Error("UNMATCHED_IMAGE_CALL");
    return { ...common, status: "operational", usable: true,
      message: "本次 Responses 图片生成核实通过；尚未验证编辑或发布能力。",
      imageSummary: { responseId: output.responseId, imageCalls: output.imageCalls } };
  } catch (error) {
    const timedOut = signal.aborted;
    return { ...common, status: "failed", usable: false,
      failureCode: timedOut ? "RESPONSES_IMAGE_TIMEOUT" : error instanceof BodyLimitExceededError ? "RESPONSES_IMAGE_LIMIT_EXCEEDED" : "RESPONSES_IMAGE_RESULT_INVALID",
      message: timedOut ? "图片核实超时；请核对上游后自主重试。" : error instanceof BodyLimitExceededError ? "图片结果超过读取限制；请核对上游输出。" : "未收到完整、可解码的单张图片；请核对内置图片支持后自主重试。" };
  }
}
