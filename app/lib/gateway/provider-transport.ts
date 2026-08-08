import { decryptCredential } from "../security/credential-encryption";
import type { ResolvedBillableModel } from "../models/resolver";
import { GatewayError } from "./errors";
import { resolveAnthropicAuthMode } from "./provider-auth";
import { resolveProviderBaseUrl } from "./provider-endpoint";

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
  const timeout = setTimeout(() => controller.abort(new DOMException("Provider timeout", "TimeoutError")), input.timeoutMs);
  const abort = () => controller.abort(input.requestSignal.reason);
  input.requestSignal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cleanup: () => {
      clearTimeout(timeout);
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
    if (resolveAnthropicAuthMode(input.resolved.provider.config) === "bearer") {
      headers.set("authorization", `Bearer ${secret}`);
    } else {
      headers.set("x-api-key", secret);
    }
  } else {
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
