// [Input] Authenticated model-validation requests plus generic static or product-managed Provider state.
// [Output] Minimal validation status plus bounded, credential-redacted upstream failure diagnostics for models.write.
// [Pos] Shared Admin model validation primitive using the same auth and product dialects as Gateway.
// [Sync] 2026-09-04: validate managed products through fixed resources while preserving static API keys.
// [Sync] 2026-09-04: resolve managed validation only through the Provider-owned account.
// [Sync] 2026-10-02: preserve concrete rejection reasons without persisting response bodies or reading successful output.
// [Sync] 2026-10-02: share Gateway's model-scoped Codex client metadata precedence.
// [Sync] 2026-10-10: validate the configured Chat/Responses endpoint with Gateway's same request conversion.
// [Sync] 2026-10-11: verify one real hosted Responses image through the original audited model boundary.

import type { PoolClient } from "pg";
import { z } from "zod";
import { imageApiPolicy } from "../../../config/image-api-policy";
import { readLimitedBody } from "../gateway/read-limited-body";
import { readResponsesImageValidation, responsesImageValidationKind, responsesImageValidationPrompt, type ResponsesImageValidationSummary } from "./responses-image-validation";

import type { AiProviderProtocol } from "../billing/types";
import { resolveManagedProviderAccess } from "../gateway/managed-provider-credentials";
import { adaptProviderRequest } from "../gateway/protocol-adapters";
import { resolveProviderAuthMode } from "../gateway/provider-auth";
import { resolveProviderInferenceEndpoint, resolveProviderApi } from "../gateway/provider-endpoint";
import { redactProviderErrorBody } from "../gateway/payloads";
import { readResponseText } from "../providers/http";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { decryptCredential } from "../security/credential-encryption";
import {
  applyManagedProviderRequestHeaders,
  applyModelRequestHeaders,
  modelRequestHeadersSchema,
  type ModelRequestHeaders,
} from "../models/request-headers";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";
import type { ProviderProductKind } from "../providers";

type ModelValidationRow = {
  id: string;
  code: string;
  upstream_model: string;
  max_output_tokens: number | null;
  request_headers: unknown;
  provider_id: string;
  provider_code: string;
  provider_status: "active" | "disabled";
  protocol: AiProviderProtocol;
  base_url: string | null;
  adapter_kind: "generic" | ProviderProductKind;
  active_credential_kind: "static_api_key" | "managed_oauth" | "none";
  auth_epoch: number;
  managed_account_binding_mode: "follow_default" | "pinned" | null;
  managed_account_id: string | null;
  managed_account_auth_epoch: number | null;
  managed_default_revision: number | null;
  managed_credential_status: "connected" | "reauth_required" | "disconnected" | null;
  managed_credential_revision: number | null;
  timeout_ms: number;
  config: Record<string, unknown> | null;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
};

export type ModelValidationResult = {
  status: "operational" | "degraded" | "failed";
  usable: boolean;
  responseTimeMs: number | null;
  httpStatus: number | null;
  testedAt: string;
  message: string;
  upstreamMessage?: string;
  upstreamRequestId?: string;
  validationKind?: typeof responsesImageValidationKind;
  failureCode?: string;
  upstreamErrorCode?: string;
  upstreamErrorType?: string;
  imageSummary?: ResponsesImageValidationSummary;
};

export const modelValidationInputSchema = z.strictObject({ validationKind: z.literal(responsesImageValidationKind).optional() });

type ValidationResponse = Pick<Response, "status"> & Partial<Pick<Response, "headers" | "body">>;

type ValidationFetch = (
  input: string,
  init: RequestInit,
) => Promise<ValidationResponse>;

async function validationDiagnostics(
  response: ValidationResponse,
  credentialHeaders: Headers,
): Promise<Pick<ModelValidationResult, "upstreamMessage" | "upstreamRequestId">> {
  if (response.status >= 200 && response.status < 300) {
    await response.body?.cancel().catch(() => undefined);
    return {};
  }
  const upstreamRequestId = response.headers?.get("request-id")
    ?? response.headers?.get("x-request-id");
  const result: Pick<ModelValidationResult, "upstreamMessage" | "upstreamRequestId"> = {};
  if (upstreamRequestId) {
    result.upstreamRequestId = String(redactProviderErrorBody(upstreamRequestId, [credentialHeaders]));
  }
  if (!response.body) return result;
  try {
    const raw = await readResponseText({
      status: response.status,
      headers: response.headers ?? new Headers(),
      body: response.body,
    });
    let body: unknown = raw;
    try { body = JSON.parse(raw); } catch { /* preserve plain-text rejection messages */ }
    const safe = redactProviderErrorBody(body, [credentialHeaders]);
    const record = safe && typeof safe === "object" && !Array.isArray(safe)
      ? safe as Record<string, unknown>
      : undefined;
    const error = record?.error && typeof record.error === "object"
      ? record.error as Record<string, unknown>
      : undefined;
    const message = [record?.detail, error?.message, record?.message, typeof safe === "string" ? safe : undefined]
      .find((value): value is string => typeof value === "string" && value.trim() !== "");
    if (message) result.upstreamMessage = message;
  } catch {
    // Diagnostic reads must preserve the already received HTTP failure classification.
  }
  return result;
}

function validationMessage(status: number) {
  if (status >= 200 && status < 300) {
    return { status: "operational" as const, usable: true, message: "凭据与上游模型验证通过" };
  }
  if (status === 401 || status === 403) {
    return { status: "failed" as const, usable: false, message: "上游拒绝了已保存的 Provider 凭据" };
  }
  if (status === 400 || status === 404 || status === 422) {
    return { status: "failed" as const, usable: false, message: "上游未接受当前模型或协议配置" };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { status: "degraded" as const, usable: false, message: "上游可达，但暂时无法完成模型验证" };
  }
  return { status: "failed" as const, usable: false, message: "上游拒绝了模型验证请求" };
}

function abortMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError"
    ? "模型验证请求超时"
    : "无法连接模型上游";
}

/**
 * Sends one non-streaming, one-token request to validate the stored credential,
 * protocol and upstream model. Response content is deliberately never read.
 */
export async function validateUpstreamModel(
  input: {
    protocol: AiProviderProtocol;
    baseUrl: string;
    upstreamModel: string;
    credential: string;
    config?: Record<string, unknown>;
    requestHeaders?: ModelRequestHeaders;
    timeoutMs?: number;
    validationKind?: typeof responsesImageValidationKind;
    maxOutputTokens?: number;
  },
  dependencies: {
    fetcher?: ValidationFetch;
    now?: () => number;
    testedAt?: () => Date;
  } = {},
): Promise<ModelValidationResult> {
  const imageValidation = input.validationKind === responsesImageValidationKind;
  if (imageValidation && (input.protocol !== "openai" || resolveProviderApi(input) !== "responses")) {
    throw new AdminError("RESPONSES_IMAGE_VALIDATION_UNSUPPORTED", "请选择 Codex 或已明确使用 Responses 的 OpenAI Provider 模型。", 409);
  }
  const endpoint = resolveProviderInferenceEndpoint(input);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const testedAt = dependencies.testedAt ?? (() => new Date());
  const startedAt = now();
  const authMode = resolveProviderAuthMode({
    protocol: input.protocol,
    config: input.config ?? {},
  });
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "accept-encoding": "identity",
    "user-agent": "Ink-Memory-Admin/Model-Validation",
    ...(authMode === "bearer"
      ? { authorization: `Bearer ${input.credential}` }
      : { "x-api-key": input.credential }),
    ...(input.protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
  };
  const requestHeaders = new Headers(headers);
  applyModelRequestHeaders(requestHeaders, input.requestHeaders ?? {});
  const outputTokenParam =
    input.protocol === "openai" && input.config?.outputTokenParam === "max_completion_tokens"
      ? "max_completion_tokens"
      : "max_tokens";
  const outputTokens = imageValidation ? input.maxOutputTokens : 1;
  if (imageValidation && (!Number.isSafeInteger(outputTokens) || outputTokens! <= 0)) {
    throw new AdminError("MODEL_OUTPUT_BUDGET_UNAVAILABLE", "请先配置模型输出预算再核实图片能力。", 409);
  }
  const prompt = imageValidation ? responsesImageValidationPrompt : "ping";
  const chatBody = input.protocol === "anthropic"
    ? { model: input.upstreamModel, max_tokens: 1, stream: false, messages: [{ role: "user", content: "ping" }] }
    : { model: input.upstreamModel, [outputTokenParam]: outputTokens, stream: false, messages: [{ role: "user", content: prompt }] };
  const body = resolveProviderApi(input) === "responses"
    ? adaptProviderRequest({ externalProtocol: "openai", providerProtocol: input.protocol,
        providerConfig: input.config, body: chatBody, model: input.upstreamModel, maxOutputTokens: outputTokens! })
    : chatBody;
  if (imageValidation) Object.assign(body, { tools: [{ type: "image_generation" }], tool_choice: "auto", parallel_tool_calls: false });

  try {
    const signal = AbortSignal.timeout(imageValidation ? input.timeoutMs ?? 8_000 : Math.min(Math.max(input.timeoutMs ?? 8_000, 1_000), 15_000));
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal,
    });
    if (imageValidation) return {
      ...await readResponsesImageValidation({ response, adapterKind: "generic", credentialHeaders: requestHeaders, signal }),
      responseTimeMs: Math.max(0, now() - startedAt), httpStatus: response.status, testedAt: testedAt().toISOString(),
    };
    const classified = validationMessage(response.status);
    const diagnostics = await validationDiagnostics(response, requestHeaders);
    return {
      ...classified,
      ...diagnostics,
      responseTimeMs: Math.max(0, now() - startedAt),
      httpStatus: response.status,
      testedAt: testedAt().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      usable: false,
      responseTimeMs: null,
      httpStatus: null,
      testedAt: testedAt().toISOString(),
      message: abortMessage(error),
      ...(imageValidation ? { validationKind: responsesImageValidationKind, failureCode: "RESPONSES_IMAGE_TRANSPORT_FAILED" } : {}),
    };
  }
}

export async function validateManagedUpstreamModel(
  input: {
    providerId: string;
    adapterKind: ProviderProductKind;
    authEpoch: number;
    managedAccountId: string;
    managedAccountAuthEpoch: number;
    managedDefaultRevision?: number;
    credentialRevision: number;
    upstreamModel: string;
    requestHeaders?: ModelRequestHeaders;
    validationKind?: typeof responsesImageValidationKind;
    timeoutMs?: number;
    maxOutputTokens?: number;
  },
  dependencies: {
    fetcher?: ValidationFetch;
    resolveAccess?: typeof resolveManagedProviderAccess;
    now?: () => number;
    testedAt?: () => Date;
  } = {},
): Promise<ModelValidationResult> {
  const imageValidation = input.validationKind === responsesImageValidationKind;
  if (imageValidation && input.adapterKind !== "codex") {
    throw new AdminError("RESPONSES_IMAGE_VALIDATION_UNSUPPORTED", "请选择 Codex 或已明确使用 Responses 的 OpenAI Provider 模型。", 409);
  }
  const fetcher = dependencies.fetcher ?? fetch;
  const resolveAccess = dependencies.resolveAccess ?? resolveManagedProviderAccess;
  const now = dependencies.now ?? Date.now;
  const testedAt = dependencies.testedAt ?? (() => new Date());
  const startedAt = now();
  try {
    const access = await resolveAccess({
      providerId: input.providerId,
      adapterKind: input.adapterKind,
      authEpoch: input.authEpoch,
      managedAccountId: input.managedAccountId,
      managedAccountAuthEpoch: input.managedAccountAuthEpoch,
      managedDefaultRevision: input.managedDefaultRevision,
      credentialRevision: input.credentialRevision,
    });
    const body = adaptProviderRequest({
      externalProtocol: "openai",
      providerProtocol: "openai",
      providerAdapterKind: input.adapterKind,
      body: {
        model: input.upstreamModel,
        max_completion_tokens: 1,
        messages: [{ role: "user", content: imageValidation ? responsesImageValidationPrompt : "ping" }],
        stream: false,
      },
      model: input.upstreamModel,
      maxOutputTokens: 1,
    });
    if (imageValidation) Object.assign(body, { tools: [{ type: "image_generation" }], tool_choice: "auto", parallel_tool_calls: false });
    const headers = new Headers({
      accept: (body as { stream?: boolean }).stream
        ? "text/event-stream"
        : "application/json",
      "content-type": "application/json",
    });
    applyModelRequestHeaders(headers, input.requestHeaders ?? {});
    applyManagedProviderRequestHeaders(headers, access.headers, input.requestHeaders ?? {}, input.adapterKind);
    const signal = AbortSignal.timeout(imageValidation ? input.timeoutMs ?? 15_000 : 15_000);
    const response = await fetcher(access.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal,
    });
    if (imageValidation) return {
      ...await readResponsesImageValidation({ response, adapterKind: input.adapterKind, credentialHeaders: headers, signal }),
      responseTimeMs: Math.max(0, now() - startedAt), httpStatus: response.status, testedAt: testedAt().toISOString(),
    };
    const classified = validationMessage(response.status);
    const diagnostics = await validationDiagnostics(response, headers);
    return {
      ...classified,
      ...diagnostics,
      responseTimeMs: Math.max(0, now() - startedAt),
      httpStatus: response.status,
      testedAt: testedAt().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      usable: false,
      responseTimeMs: null,
      httpStatus: null,
      testedAt: testedAt().toISOString(),
      message: abortMessage(error),
      ...(imageValidation ? { validationKind: responsesImageValidationKind, failureCode: "RESPONSES_IMAGE_TRANSPORT_FAILED" } : {}),
    };
  }
}

async function loadModel(client: PoolClient, modelId: string) {
  const { rows } = await client.query<ModelValidationRow>(
    `SELECT m.id, m.code, m.upstream_model, m.request_headers, m.max_output_tokens,
            p.id AS provider_id, p.code AS provider_code,
            p.status AS provider_status, p.protocol, p.base_url,
            p.adapter_kind, p.active_credential_kind, p.auth_epoch,
            p.managed_account_binding_mode,
            managed.id AS managed_account_id,
            managed.auth_epoch AS managed_account_auth_epoch,
            NULL::integer AS managed_default_revision,
            managed.status AS managed_credential_status,
            managed.revision AS managed_credential_revision,
            p.timeout_ms, p.config,
            p.api_key_ciphertext, p.api_key_iv, p.api_key_tag
     FROM ai_models AS m
     JOIN ai_providers AS p ON p.id = m.provider_id
     LEFT JOIN ai_provider_managed_credentials AS managed
       ON managed.adapter_kind = p.adapter_kind
      AND managed.id = p.managed_credential_id
      AND managed.provider_id = p.id
     WHERE m.id = $1`,
    [modelId],
  );
  const row = rows[0];
  if (!row) {
    throw new AdminError("ADMIN_RESOURCE_ITEM_NOT_FOUND", "The requested model does not exist", 404);
  }
  if (
    row.adapter_kind === "generic" &&
    (!row.api_key_ciphertext || !row.api_key_iv || !row.api_key_tag)
  ) {
    throw new AdminError("PROVIDER_CREDENTIAL_UNAVAILABLE", "The model Provider has no stored credential", 409);
  }
  if (
    row.adapter_kind !== "generic" &&
    (
      row.provider_status !== "active" ||
      row.active_credential_kind !== "managed_oauth" ||
      row.managed_credential_status !== "connected" ||
      row.managed_account_id === null ||
      row.managed_account_auth_epoch === null ||
      row.managed_credential_revision === null
    )
  ) {
    throw new AdminError(
      "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE",
      "Enable the Provider with a connected product account before validating this model",
      409,
    );
  }
  return row;
}

export async function handleModelValidation(request: Request, modelId: string) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "models.write");
    let validationKind: typeof responsesImageValidationKind | undefined;
    try {
      const raw = await readLimitedBody({ body: request.body, declaredLength: request.headers.get("content-length"), maxBytes: imageApiPolicy.maxPromptBytes });
      const text = new TextDecoder().decode(raw);
      validationKind = modelValidationInputSchema.parse(text.trim() ? JSON.parse(text) : {}).validationKind;
    } catch {
      throw new AdminError("MODEL_VALIDATION_INPUT_INVALID", "模型验证请求格式不正确。", 400);
    }
    const model = await withPlatformClient((client) => loadModel(client, modelId));
    const requestHeaders = modelRequestHeadersSchema.safeParse(model.request_headers ?? {});
    if (!requestHeaders.success) {
      throw new AdminError("MODEL_REQUEST_HEADERS_INVALID", "The model has invalid upstream request headers", 409);
    }
    const data = model.adapter_kind === "generic"
      ? await validateUpstreamModel({
          protocol: model.protocol,
          baseUrl: model.base_url!,
          upstreamModel: model.upstream_model,
          credential: decryptCredential({
            ciphertext: model.api_key_ciphertext!,
            iv: model.api_key_iv!,
            tag: model.api_key_tag!,
          }),
          config: model.config ?? {},
          requestHeaders: requestHeaders.data,
          timeoutMs: model.timeout_ms,
          validationKind,
          maxOutputTokens: model.max_output_tokens ?? undefined,
        })
      : await validateManagedUpstreamModel({
          providerId: model.provider_id,
          adapterKind: model.adapter_kind,
          authEpoch: model.auth_epoch,
          managedAccountId: model.managed_account_id!,
          managedAccountAuthEpoch: model.managed_account_auth_epoch!,
          managedDefaultRevision: model.managed_default_revision ?? undefined,
          credentialRevision: model.managed_credential_revision!,
          upstreamModel: model.upstream_model,
          requestHeaders: requestHeaders.data,
          validationKind,
          timeoutMs: model.timeout_ms,
          maxOutputTokens: model.max_output_tokens ?? undefined,
        });

    await withPlatformTransaction(async (client) => {
      await recordAdminAuditOnClient(client, {
        identity,
        action: "model_validation",
        resourceType: "models",
        resourceId: model.id,
        requestId,
        request,
        metadata: {
          modelCode: model.code,
          providerCode: model.provider_code,
          status: data.status,
          usable: data.usable,
          responseTimeMs: data.responseTimeMs,
          httpStatus: data.httpStatus,
          ...(data.validationKind ? {
            validationKind: data.validationKind, failureCode: data.failureCode,
            upstreamErrorCode: data.upstreamErrorCode, upstreamErrorType: data.upstreamErrorType,
            upstreamRequestId: data.upstreamRequestId, imageSummary: data.imageSummary,
          } : {}),
        },
      });
    });
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
