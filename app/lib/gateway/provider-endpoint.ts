// [Input] Provider protocol/base URL plus explicit host and local-topology capabilities.
// [Output] A canonical SSRF-fenced Provider base URL, explicitly selected inference API and endpoint, or a safe configuration error.
// [Pos] Shared static Provider endpoint boundary for Admin validation and Gateway execution.
// [Sync] 2026-09-04: make localhost opt-in an explicit capability independent of deployment labels.
// [Sync] 2026-10-10: share explicit generic OpenAI Chat/Responses selection between validation, transport and response adapters.

import { isIP } from "node:net";
import type { AiProviderProtocol } from "../billing/types";
import { GatewayError } from "./errors";

type ProviderApiInput = {
  protocol: AiProviderProtocol;
  adapterKind?: string;
  config?: Record<string, unknown>;
};

export function resolveProviderApi(input: ProviderApiInput): "messages" | "chat" | "responses" {
  const adapter = input.adapterKind ?? "generic";
  const configured = input.config && Object.hasOwn(input.config, "openaiApi");
  if (adapter !== "generic" && input.protocol !== "openai") {
    throw new GatewayError("PROVIDER_API_INVALID", "Managed product Providers require the OpenAI protocol", 503, "configuration_error");
  }
  if (configured && (input.protocol !== "openai" || adapter !== "generic"
    || !["chat", "responses"].includes(String(input.config?.openaiApi))
    || typeof input.config?.openaiApi !== "string")) {
    throw new GatewayError("PROVIDER_API_INVALID", "OpenAI inference API must be chat or responses on a generic OpenAI Provider", 503, "configuration_error");
  }
  if (adapter === "codex" || adapter === "xai") return "responses";
  return input.protocol === "anthropic" ? "messages"
    : input.config?.openaiApi === "responses" ? "responses" : "chat";
}

export function resolveResponsesAdapter(input: ProviderApiInput): "codex" | "xai" | "openai" | undefined {
  if (resolveProviderApi(input) !== "responses") return undefined;
  return input.adapterKind === "codex" || input.adapterKind === "xai" ? input.adapterKind : "openai";
}

export function resolveProviderInferenceEndpoint(input: ProviderApiInput & { baseUrl: string; requestUrl?: string }) {
  const api = resolveProviderApi(input);
  const url = new URL(resolveProviderBaseUrl(input));
  const suffix = api === "messages" ? "messages" : api === "responses" ? "responses" : "chat/completions";
  const current = url.pathname.replace(/\/+$/, "");
  if (!current.endsWith(`/${suffix}`)) {
    if (/\/(messages|chat\/completions|responses|images\/(generations|edits))$/.test(current)) {
      throw new GatewayError("PROVIDER_ENDPOINT_API_MISMATCH", "The Provider endpoint does not match its configured inference API", 503, "configuration_error");
    }
    url.pathname = current.endsWith("/v1") ? `${current}/${suffix}` : `${current}/v1/${suffix}`;
  }
  if (api === "messages" && input.requestUrl) {
    const beta = new URL(input.requestUrl).searchParams.get("beta");
    if (beta === "true" || beta === "1") url.searchParams.set("beta", beta);
  }
  return url.toString();
}

const DEFAULT_PROVIDER_HOSTS: Record<AiProviderProtocol, ReadonlySet<string>> = {
  anthropic: new Set(["api.anthropic.com", "api.deepseek.com"]),
  openai: new Set(["api.openai.com", "api.deepseek.com"]),
};

function configuredHosts() {
  return new Set(
    (process.env.AI_PROVIDER_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function isPrivateIp(hostname: string) {
  if (isIP(hostname) === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(hostname) === 6) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return false;
}

export function resolveProviderBaseUrl(input: {
  protocol: AiProviderProtocol;
  baseUrl: string;
}) {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new GatewayError(
      "PROVIDER_BASE_URL_INVALID",
      "The selected provider has an invalid base URL",
      503,
      "configuration_error",
    );
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new GatewayError(
      "PROVIDER_BASE_URL_INVALID",
      "Provider base URLs cannot contain credentials, query strings, or fragments",
      503,
      "configuration_error",
    );
  }

  const hostname = url.hostname.toLowerCase();
  const localTopologyAllowed =
    process.env.AI_PROVIDER_ALLOW_INSECURE_LOCALHOST === "true";

  if (isLocalHostname(hostname)) {
    if (!localTopologyAllowed || !["http:", "https:"].includes(url.protocol)) {
      throw new GatewayError(
        "PROVIDER_HOST_NOT_ALLOWED",
        "Local provider endpoints require the explicit topology capability",
        503,
        "configuration_error",
      );
    }
  } else {
    if (url.protocol !== "https:") {
      throw new GatewayError(
        "PROVIDER_HTTPS_REQUIRED",
        "Provider endpoints must use HTTPS",
        503,
        "configuration_error",
      );
    }
    if (isPrivateIp(hostname)) {
      throw new GatewayError(
        "PROVIDER_HOST_NOT_ALLOWED",
        "Private and reserved provider IP addresses are not allowed",
        503,
        "configuration_error",
      );
    }
    const trusted = new Set([
      ...DEFAULT_PROVIDER_HOSTS[input.protocol],
      ...configuredHosts(),
    ]);
    if (!trusted.has(hostname)) {
      throw new GatewayError(
        "PROVIDER_HOST_NOT_ALLOWED",
        `Provider host ${hostname} is not in AI_PROVIDER_HOST_ALLOWLIST`,
        503,
        "configuration_error",
      );
    }
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
