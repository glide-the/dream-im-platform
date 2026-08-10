import type { PoolClient } from "pg";

import type { AiProviderProtocol } from "../billing/types";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { decryptCredential } from "../security/credential-encryption";
import {
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

type ModelValidationRow = {
  id: string;
  code: string;
  upstream_model: string;
  request_headers: unknown;
  provider_id: string;
  provider_code: string;
  protocol: AiProviderProtocol;
  base_url: string;
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
};

type ValidationFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "status">>;

function endpoint(baseUrl: string, protocol: AiProviderProtocol) {
  const url = new URL(baseUrl);
  const suffix = protocol === "anthropic" ? "messages" : "chat/completions";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/${suffix}` : `${path}/v1/${suffix}`;
  return url.toString();
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
  },
  dependencies: {
    fetcher?: ValidationFetch;
    now?: () => number;
    testedAt?: () => Date;
  } = {},
): Promise<ModelValidationResult> {
  const baseUrl = resolveProviderBaseUrl({ protocol: input.protocol, baseUrl: input.baseUrl });
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const testedAt = dependencies.testedAt ?? (() => new Date());
  const startedAt = now();
  const authMode = input.config?.authMode === "bearer" ? "bearer" : "x-api-key";
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
  const body = input.protocol === "anthropic"
    ? { model: input.upstreamModel, max_tokens: 1, stream: false, messages: [{ role: "user", content: "ping" }] }
    : { model: input.upstreamModel, [outputTokenParam]: 1, stream: false, messages: [{ role: "user", content: "ping" }] };

  try {
    const response = await fetcher(endpoint(baseUrl, input.protocol), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(Math.max(input.timeoutMs ?? 8_000, 1_000), 15_000)),
    });
    const classified = validationMessage(response.status);
    return {
      ...classified,
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
    };
  }
}

async function loadModel(client: PoolClient, modelId: string) {
  const { rows } = await client.query<ModelValidationRow>(
    `SELECT m.id, m.code, m.upstream_model, m.request_headers,
            p.id AS provider_id, p.code AS provider_code, p.protocol,
            p.base_url, p.timeout_ms, p.config,
            p.api_key_ciphertext, p.api_key_iv, p.api_key_tag
     FROM ai_models AS m
     JOIN ai_providers AS p ON p.id = m.provider_id
     WHERE m.id = $1`,
    [modelId],
  );
  const row = rows[0];
  if (!row) {
    throw new AdminError("ADMIN_RESOURCE_ITEM_NOT_FOUND", "The requested model does not exist", 404);
  }
  if (!row.api_key_ciphertext || !row.api_key_iv || !row.api_key_tag) {
    throw new AdminError("PROVIDER_CREDENTIAL_UNAVAILABLE", "The model Provider has no stored credential", 409);
  }
  return row;
}

export async function handleModelValidation(request: Request, modelId: string) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "models.write");
    const model = await withPlatformClient((client) => loadModel(client, modelId));
    const credential = decryptCredential({
      ciphertext: model.api_key_ciphertext!,
      iv: model.api_key_iv!,
      tag: model.api_key_tag!,
    });
    const requestHeaders = modelRequestHeadersSchema.safeParse(model.request_headers ?? {});
    if (!requestHeaders.success) {
      throw new AdminError("MODEL_REQUEST_HEADERS_INVALID", "The model has invalid upstream request headers", 409);
    }
    const data = await validateUpstreamModel({
      protocol: model.protocol,
      baseUrl: model.base_url,
      upstreamModel: model.upstream_model,
      credential,
      config: model.config ?? {},
      requestHeaders: requestHeaders.data,
      timeoutMs: model.timeout_ms,
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
