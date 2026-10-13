// [Input] Resolved Image Provider, normalized JSON or multipart body, cancellation, and request fence.
// [Output] Authenticated OpenAI/Codex Image response with one bounded managed-credential renewal retry.
// [Pos] Images-only HTTP transport; it never enters Messages/Chat adaptation or payload capture.
// [Sync] 2026-10-09: add distinct public OpenAI and registry-owned Codex Images transport paths.

import type { ResolvedBillableModel } from "../models/resolver";
import type { TokenUsage } from "../billing/types";
import { applyManagedProviderRequestHeaders, applyModelRequestHeaders } from "../models/request-headers";
import { GatewayError } from "./errors";
import { resolveManagedProviderImageAccess } from "./managed-provider-credentials";
import { redactProviderErrorBody } from "./payloads";
import { resolveProviderAuthMode } from "./provider-auth";
import { resolveProviderBaseUrl } from "./provider-endpoint";
import {
  ProviderHttpError,
  ProviderTimeoutError,
  resolveProviderCredential,
} from "./provider-transport";
import { recordGatewayProviderCredentialUse } from "./repository";
import { BodyLimitExceededError, readLimitedBody } from "./read-limited-body";
import { parseImageProviderUsage } from "./image-protocols";

type ImageOperation = "images.generations" | "images.edits";

function staticEndpoint(baseUrl: string, operation: ImageOperation) {
  const url = new URL(baseUrl);
  const suffix = operation === "images.generations"
    ? "images/generations"
    : "images/edits";
  let current = url.pathname.replace(/\/+$/, "");
  current = current.replace(/\/v1\/(chat\/completions|responses)$/, "/v1");
  url.pathname = current.endsWith("/v1")
    ? `${current}/${suffix}`
    : `${current}/v1/${suffix}`;
  return url.toString();
}

function linkedAbort(requestSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new ProviderTimeoutError("connect")),
    timeoutMs,
  );
  const abort = () => controller.abort(requestSignal.reason);
  if (requestSignal.aborted) abort();
  else requestSignal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      requestSignal.removeEventListener("abort", abort);
    },
  };
}

function throwIfRequestAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The downstream client cancelled the request", "AbortError");
}

export class ImageProviderHttpError extends ProviderHttpError {
  constructor(
    status: number,
    responseBody: unknown,
    requestId: string | undefined,
    public readonly usage?: TokenUsage,
  ) {
    super(status, responseBody, requestId);
    this.name = "ImageProviderHttpError";
  }
}

async function boundedErrorBody(response: Response) {
  const maxBytes = 1_048_576;
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody({
      body: response.body,
      declaredLength: response.headers.get("content-length"),
      maxBytes,
    });
  } catch (error) {
    if (error instanceof BodyLimitExceededError) {
      return { error: "upstream_error_body_too_large" };
    }
    throw error;
  }
  const raw = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function managedCoordinates(resolved: ResolvedBillableModel) {
  if (
    resolved.provider.adapterKind !== "codex"
    || resolved.provider.activeCredentialKind !== "managed_oauth"
    || !resolved.provider.authEpoch
    || !resolved.provider.managedAccountId
    || !resolved.provider.managedAccountAuthEpoch
  ) {
    throw new GatewayError(
      "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE",
      "The selected Codex Provider has no effective managed credential",
      503,
      "configuration_error",
    );
  }
  return {
    providerId: resolved.provider.id,
    adapterKind: "codex" as const,
    authEpoch: resolved.provider.authEpoch,
    managedAccountId: resolved.provider.managedAccountId,
    managedAccountAuthEpoch: resolved.provider.managedAccountAuthEpoch,
    credentialRevision: resolved.provider.credentialRevision,
  };
}

export async function sendImageProviderRequest(input: {
  resolved: ResolvedBillableModel;
  operation: ImageOperation;
  body: Record<string, unknown> | FormData;
  requestSignal: AbortSignal;
  gatewayRequestId: string;
  onDispatch?: () => void;
}) {
  throwIfRequestAborted(input.requestSignal);
  const adapterKind = input.resolved.provider.adapterKind ?? "generic";
  const headers = new Headers({ accept: "application/json" });
  applyModelRequestHeaders(headers, input.resolved.model.requestHeaders ?? {});
  let endpoint: string;
  let encodedBody: BodyInit;
  let managedCredentialRevision: number | undefined;
  let managedRenewed = false;

  if (adapterKind === "codex") {
    if (input.body instanceof FormData) {
      throw new GatewayError(
        "CODEX_IMAGE_BODY_INVALID",
        "Codex Image requests must use the registry JSON contract",
        500,
        "internal_error",
      );
    }
    const access = await resolveManagedProviderImageAccess(
      managedCoordinates(input.resolved),
    );
    throwIfRequestAborted(input.requestSignal);
    endpoint = input.operation === "images.generations"
      ? access.generationsUrl
      : access.editsUrl;
    managedCredentialRevision = access.credentialRevision;
    managedRenewed = access.renewed;
    applyManagedProviderRequestHeaders(
      headers,
      access.headers,
      input.resolved.model.requestHeaders ?? {},
      "codex",
    );
    headers.set("content-type", "application/json");
    headers.set("x-codex-image-turn-id", input.gatewayRequestId);
    encodedBody = JSON.stringify(input.body);
    await recordGatewayProviderCredentialUse({
      requestId: input.gatewayRequestId,
      credentialRevision: access.credentialRevision,
      managedAccountId: access.accountId,
      managedAccountAuthEpoch: access.accountAuthEpoch,
      renewalAttempted: access.renewed,
    });
  } else {
    if (adapterKind !== "generic" || input.resolved.provider.protocol !== "openai") {
      throw new GatewayError(
        "PROVIDER_IMAGE_API_UNSUPPORTED",
        "The selected Provider does not expose the Images API",
        503,
        "configuration_error",
      );
    }
    const baseUrl = resolveProviderBaseUrl({
      protocol: "openai",
      baseUrl: input.resolved.provider.baseUrl ?? "",
    });
    endpoint = staticEndpoint(baseUrl, input.operation);
    const secret = resolveProviderCredential(input.resolved);
    const authMode = resolveProviderAuthMode({
      protocol: "openai",
      config: input.resolved.provider.config,
    });
    headers.set(authMode === "bearer" ? "authorization" : "x-api-key", authMode === "bearer" ? `Bearer ${secret}` : secret);
    if (input.body instanceof FormData) {
      encodedBody = input.body;
    } else {
      headers.set("content-type", "application/json");
      encodedBody = JSON.stringify(input.body);
    }
  }

  const abort = linkedAbort(input.requestSignal, input.resolved.provider.timeoutMs);
  const credentialHeaders = [new Headers(headers)];
  try {
    throwIfRequestAborted(input.requestSignal);
    input.onDispatch?.();
    let response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: encodedBody,
      signal: abort.signal,
      redirect: "error",
    });
    if (response.status === 401 && adapterKind === "codex") {
      await response.body?.cancel().catch(() => undefined);
      const access = await resolveManagedProviderImageAccess({
        ...managedCoordinates(input.resolved),
        credentialRevision: managedCredentialRevision,
        forceRenew: true,
      });
      throwIfRequestAborted(input.requestSignal);
      endpoint = input.operation === "images.generations"
        ? access.generationsUrl
        : access.editsUrl;
      applyManagedProviderRequestHeaders(
        headers,
        access.headers,
        input.resolved.model.requestHeaders ?? {},
        "codex",
      );
      headers.set("content-type", "application/json");
      headers.set("x-codex-image-turn-id", input.gatewayRequestId);
      credentialHeaders.push(new Headers(headers));
      managedRenewed = true;
      await recordGatewayProviderCredentialUse({
        requestId: input.gatewayRequestId,
        credentialRevision: access.credentialRevision,
        managedAccountId: access.accountId,
        managedAccountAuthEpoch: access.accountAuthEpoch,
        renewalAttempted: true,
      });
      throwIfRequestAborted(input.requestSignal);
      input.onDispatch?.();
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: encodedBody,
        signal: abort.signal,
        redirect: "error",
      });
    }
    if (!response.ok) {
      const body = await boundedErrorBody(response);
      const requestId = response.headers.get("x-codex-imagegen-request-id")
        ?? response.headers.get("request-id")
        ?? response.headers.get("x-request-id")
        ?? undefined;
      let usage: TokenUsage | undefined;
      try {
        usage = parseImageProviderUsage(body, {
          providerModel: input.resolved.model.upstreamModel,
          upstreamRequestId: requestId,
        });
      } catch {
        usage = undefined;
      }
      throw new ImageProviderHttpError(
        response.status,
        redactProviderErrorBody(body, credentialHeaders),
        requestId,
        usage,
      );
    }
    return { response, cleanup: abort.cleanup, managedRenewed };
  } catch (error) {
    abort.cleanup();
    throw error;
  }
}
