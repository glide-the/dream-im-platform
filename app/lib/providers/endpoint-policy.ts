// [Input] Provider product, endpoint purpose, and deployment-level endpoint override.
// [Output] Canonical HTTPS endpoint restricted to an exact product host, purpose, and port policy.
// [Pos] SSRF and first-party-boundary guard for all managed provider protocol calls.
// [Sync] 2026-09-04: add a distinct exact-host policy for model catalog endpoints.

import { ProviderProtocolError } from "./errors";
import type { ProviderProductKind } from "./types";

export type ProviderEndpointPurpose =
  | "authorization"
  | "discovery"
  | "identity"
  | "token_exchange"
  | "revocation"
  | "resource"
  | "models";

const HOST_POLICY: Readonly<
  Record<ProviderProductKind, Readonly<Record<ProviderEndpointPurpose, readonly string[]>>>
> = {
  codex: {
    authorization: ["auth.openai.com"],
    discovery: ["auth.openai.com"],
    identity: ["auth.openai.com"],
    token_exchange: ["auth.openai.com"],
    revocation: ["auth.openai.com"],
    resource: ["chatgpt.com"],
    models: ["chatgpt.com"],
  },
  xai: {
    authorization: ["auth.x.ai"],
    discovery: ["auth.x.ai"],
    identity: ["auth.x.ai"],
    token_exchange: ["auth.x.ai"],
    revocation: ["auth.x.ai"],
    resource: ["api.x.ai"],
    models: ["api.x.ai"],
  },
  github_copilot: {
    authorization: ["github.com"],
    discovery: ["github.com"],
    identity: ["api.github.com"],
    token_exchange: ["github.com", "api.github.com"],
    revocation: ["api.github.com"],
    resource: ["api.githubcopilot.com"],
    models: ["api.githubcopilot.com"],
  },
};

type EndpointInput = Readonly<{
  product: ProviderProductKind;
  purpose: ProviderEndpointPurpose;
  value: string;
}>;

function resolveEndpoint(input: EndpointInput, allowQuery: boolean): string {
  let url: URL;
  try {
    url = new URL(input.value);
  } catch {
    throw new ProviderProtocolError({
      code: "PROVIDER_ENDPOINT_INVALID",
      category: "configuration",
      message: "The configured provider endpoint is invalid",
    });
  }

  const host = url.hostname.toLowerCase();
  const allowedHosts = HOST_POLICY[input.product][input.purpose];
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (!allowQuery && url.search !== "") ||
    url.hash !== "" ||
    !allowedHosts.includes(host)
  ) {
    throw new ProviderProtocolError({
      code: "PROVIDER_ENDPOINT_NOT_ALLOWED",
      category: "configuration",
      message: "The configured provider endpoint is outside the product allowlist",
    });
  }

  return url.toString();
}

export function resolveProviderEndpoint(input: EndpointInput): string {
  return resolveEndpoint(input, false);
}

export function resolveProviderVerificationUri(
  input: Omit<EndpointInput, "purpose">,
): string {
  return resolveEndpoint({ ...input, purpose: "authorization" }, true);
}
