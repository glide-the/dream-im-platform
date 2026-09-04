// [Input] Resolved generic/product Provider, request body, cancellation signal, credential revision, and timeout policy.
// [Output] Authenticated response plus lifecycle-safe abort control and a bounded managed-auth 401 recovery path.
// [Pos] Low-level Gateway HTTP transport joining static credentials or the managed product credential broker.
// [Sync] 2026-09-04: managed transport follows one Provider-owned credential and keeps bounded renewal retry fences.

import { decryptCredential } from "../security/credential-encryption";
import type { ResolvedBillableModel } from "../models/resolver";
import { GatewayError } from "./errors";
import { resolveProviderAuthMode } from "./provider-auth";
import { resolveProviderBaseUrl } from "./provider-endpoint";
import { applyModelRequestHeaders } from "../models/request-headers";
import { resolveManagedProviderAccess } from "./managed-provider-credentials";
import { recordGatewayProviderCredentialUse } from "./repository";

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
  if (!resolved.provider.encryptedCredential) {
    throw new GatewayError(
      "PROVIDER_CREDENTIAL_UNAVAILABLE",
      "The selected provider has no usable static credential",
      503,
      "configuration_error",
    );
  }
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
  gatewayRequestId?: string;
  allowManagedCredentialRetry?: boolean;
}) {
  const protocol = input.resolved.provider.protocol;
  const headers = new Headers({
    accept: (input.body as { stream?: boolean })?.stream ? "text/event-stream" : "application/json",
    "content-type": "application/json",
  });
  const adapterKind = input.resolved.provider.adapterKind ?? "generic";
  let requestEndpoint: string;
  let renewalAttempted = false;
  let managedCredentialRevision: number | undefined;
  if (protocol === "anthropic") {
    headers.set("anthropic-version", input.requestHeaders?.get("anthropic-version") ?? "2023-06-01");
    for (const name of ["anthropic-beta", "x-app", "user-agent"] as const) {
      const value = input.requestHeaders?.get(name);
      if (value) headers.set(name, value);
    }
    applyModelRequestHeaders(headers, input.resolved.model.requestHeaders ?? {});
  } else {
    applyModelRequestHeaders(headers, input.resolved.model.requestHeaders ?? {});
  }
  if (adapterKind === "codex" || adapterKind === "xai" || adapterKind === "github_copilot") {
    if (
      input.resolved.provider.activeCredentialKind !== "managed_oauth"
      || !input.resolved.provider.authEpoch
      || !input.resolved.provider.managedAccountId
      || !input.resolved.provider.managedAccountAuthEpoch
    ) {
      throw new GatewayError(
        "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE",
        "The selected product provider has no effective managed credential",
        503,
        "configuration_error",
      );
    }
    const access = await resolveManagedProviderAccess({
      providerId: input.resolved.provider.id,
      adapterKind,
      authEpoch: input.resolved.provider.authEpoch,
      managedAccountId: input.resolved.provider.managedAccountId,
      managedAccountAuthEpoch: input.resolved.provider.managedAccountAuthEpoch,
      credentialRevision: input.resolved.provider.credentialRevision,
    });
    requestEndpoint = access.url;
    renewalAttempted = access.renewed;
    managedCredentialRevision = access.credentialRevision;
    for (const [name, value] of access.headers) headers.set(name, value);
    if (input.gatewayRequestId) {
      await recordGatewayProviderCredentialUse({
        requestId: input.gatewayRequestId,
        credentialRevision: access.credentialRevision,
        managedAccountId: access.accountId,
        managedAccountAuthEpoch: access.accountAuthEpoch,
        renewalAttempted,
      });
    }
  } else {
    if (!input.resolved.provider.baseUrl) {
      throw new GatewayError(
        "PROVIDER_BASE_URL_INVALID",
        "The selected provider has no configured base URL",
        503,
        "configuration_error",
      );
    }
    const baseUrl = resolveProviderBaseUrl({ protocol, baseUrl: input.resolved.provider.baseUrl });
    requestEndpoint = endpoint(baseUrl, protocol, input.requestUrl);
    const secret = providerCredential(input.resolved);
    const authMode = resolveProviderAuthMode({
      protocol,
      config: input.resolved.provider.config,
    });
    if (authMode === "bearer") headers.set("authorization", `Bearer ${secret}`);
    else headers.set("x-api-key", secret);
  }
  const abort = linkedAbort({ requestSignal: input.requestSignal, timeoutMs: input.resolved.provider.timeoutMs });
  try {
    let response = await fetch(requestEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
      signal: abort.signal,
      redirect: "error",
    });
    if (
      response.status === 401
      && input.allowManagedCredentialRetry === true
      && (adapterKind === "codex" || adapterKind === "xai" || adapterKind === "github_copilot")
    ) {
      await response.body?.cancel().catch(() => undefined);
      const renewed = await resolveManagedProviderAccess({
        providerId: input.resolved.provider.id,
        adapterKind,
        authEpoch: input.resolved.provider.authEpoch!,
        managedAccountId: input.resolved.provider.managedAccountId!,
        managedAccountAuthEpoch: input.resolved.provider.managedAccountAuthEpoch!,
        credentialRevision: managedCredentialRevision,
        forceRenew: true,
      });
      for (const [name, value] of renewed.headers) headers.set(name, value);
      renewalAttempted = true;
      if (input.gatewayRequestId) {
        await recordGatewayProviderCredentialUse({
          requestId: input.gatewayRequestId,
          credentialRevision: renewed.credentialRevision,
          managedAccountId: renewed.accountId,
          managedAccountAuthEpoch: renewed.accountAuthEpoch,
          renewalAttempted: true,
        });
      }
      response = await fetch(renewed.url, {
        method: "POST",
        headers,
        body: JSON.stringify(input.body),
        signal: abort.signal,
        redirect: "error",
      });
    }
    if (!response.ok) {
      let body: unknown;
      if (adapterKind === "generic") {
        const raw = await response.text();
        body = raw;
        try { body = JSON.parse(raw); } catch { /* preserve exact text */ }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
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
