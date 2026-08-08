import { isIP } from "node:net";
import type { AiProviderProtocol } from "../billing/types";
import { GatewayError } from "./errors";

const DEFAULT_PROVIDER_HOSTS: Record<AiProviderProtocol, ReadonlySet<string>> = {
  anthropic: new Set(["api.anthropic.com"]),
  openai: new Set(["api.openai.com"]),
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
  const localDevelopmentAllowed =
    process.env.NODE_ENV !== "production" &&
    process.env.AI_PROVIDER_ALLOW_INSECURE_LOCALHOST === "true";

  if (isLocalHostname(hostname)) {
    if (!localDevelopmentAllowed || !["http:", "https:"].includes(url.protocol)) {
      throw new GatewayError(
        "PROVIDER_HOST_NOT_ALLOWED",
        "Local provider endpoints require the explicit development-only opt-in",
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
