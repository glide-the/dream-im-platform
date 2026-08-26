// [Input] Resolved provider endpoint, credential, request body, cancellation signal, and provider timeout policy.
// [Output] Authenticated provider response plus a lifecycle-safe connection/stream-idle abort controller.
// [Pos] Low-level Gateway provider HTTP transport shared by Anthropic and OpenAI protocol adapters.
// [Sync] 2026-08-27: treat streaming timeout as rolling network-idle time instead of a fixed total response lifetime.

import { decryptCredential } from "../security/credential-encryption";
import type { ResolvedBillableModel } from "../models/resolver";
import { GatewayError } from "./errors";
import { resolveAnthropicAuthMode } from "./provider-auth";
import { resolveProviderBaseUrl } from "./provider-endpoint";
import { applyModelRequestHeaders } from "../models/request-headers";

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: unknown,
    public readonly requestId?: string,
  ) {
    super(`Provider returned HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

export class ProviderTimeoutError extends Error {
  constructor(public readonly phase: "connect" | "stream_idle") {
    super(phase === "connect" ? "Provider connection timed out" : "Provider stream became idle");
    this.name = "ProviderTimeoutError";
  }
}

export function isProviderTimeoutError(error: unknown): error is ProviderTimeoutError {
  return error instanceof ProviderTimeoutError
    || (error instanceof Error && error.name === "ProviderTimeoutError")
    || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "TimeoutError");
}

function providerCredential(resolved: ResolvedBillableModel) {
  try {
    return decryptCredential(resolved.provider.encryptedCredential);
  } catch {
    throw new GatewayError(
      "PROVIDER_CREDENTIAL_UNAVAILABLE",
      "The selected provider credential could not be decrypted",
      503,
      "configuration_error",
    );
  }
}

function endpoint(baseUrl: string, protocol: "anthropic" | "openai", requestUrl?: string) {
  const url = new URL(baseUrl);
  const suffix = protocol === "anthropic" ? "messages" : "chat/completions";
  const current = url.pathname.replace(/\/+$/, "");
  if (!current.endsWith(`/${suffix}`)) {
    url.pathname = current.endsWith("/v1") ? `${current}/${suffix}` : `${current}/v1/${suffix}`;
  }
  if (protocol === "anthropic" && requestUrl) {
    const beta = new URL(requestUrl).searchParams.get("beta");
    if (beta === "true" || beta === "1") url.searchParams.set("beta", beta);
  }
  return url.toString();
}

function linkedAbort(input: { requestSignal: AbortSignal; timeoutMs: number }) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const arm = (phase: "connect" | "stream_idle") => {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(new ProviderTimeoutError(phase)), input.timeoutMs);
  };
  arm("connect");
  const abort = () => controller.abort(input.requestSignal.reason);
  input.requestSignal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    refreshStreamIdleTimeout: () => {
      if (!controller.signal.aborted) arm("stream_idle");
    },
    cleanup: () => {
      if (timeout !== undefined) clearTimeout(timeout);
      input.requestSignal.removeEventListener("abort", abort);
    },
  };
}

export async function sendProviderRequest(input: {
  resolved: ResolvedBillableModel;
  body: unknown;
  requestSignal: AbortSignal;
  requestHeaders?: Headers;
  requestUrl?: string;
}) {
  const protocol = input.resolved.provider.protocol;
  const baseUrl = resolveProviderBaseUrl({ protocol, baseUrl: input.resolved.provider.baseUrl });
  const headers = new Headers({
    accept: (input.body as { stream?: boolean })?.stream ? "text/event-stream" : "application/json",
    "content-type": "application/json",
  });
  const secret = providerCredential(input.resolved);
  if (protocol === "anthropic") {
    headers.set("anthropic-version", input.requestHeaders?.get("anthropic-version") ?? "2023-06-01");
    for (const name of ["anthropic-beta", "x-app", "user-agent"] as const) {
      const value = input.requestHeaders?.get(name);
      if (value) headers.set(name, value);
    }
    applyModelRequestHeaders(headers, input.resolved.model.requestHeaders ?? {});
    if (resolveAnthropicAuthMode(input.resolved.provider.config) === "bearer") {
      headers.set("authorization", `Bearer ${secret}`);
    } else {
      headers.set("x-api-key", secret);
    }
  } else {
    applyModelRequestHeaders(headers, input.resolved.model.requestHeaders ?? {});
    headers.set("authorization", `Bearer ${secret}`);
  }
  const abort = linkedAbort({ requestSignal: input.requestSignal, timeoutMs: input.resolved.provider.timeoutMs });
  try {
    const response = await fetch(endpoint(baseUrl, protocol, input.requestUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
      signal: abort.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const raw = await response.text();
      let body: unknown = raw;
      try { body = JSON.parse(raw); } catch { /* preserve exact text */ }
      throw new ProviderHttpError(
        response.status,
        body,
        response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? undefined,
      );
    }
    return { response, abort };
  } catch (error) {
    abort.cleanup();
    throw error;
  }
}
