// [Input] Resolved product configuration, injected transport/clock, and OAuth token responses.
// [Output] Common transport helpers, authoritative scope gates, expiry calculation, and revocation material extraction.
// [Pos] Provider-neutral implementation helpers; product-specific state machines stay in their adapters.
// [Sync] 2026-09-04: centralize bounded requests, explicit granted-scope validation, and minimal revoke-material rules.

import { ProviderProtocolError } from "./errors";
import type {
  ProviderClock,
  ProviderFetch,
  ProviderProductKind,
  ProviderRevocationMaterial,
  ProviderTokenBundle,
} from "./types";

export type AdapterDependencies = Readonly<{
  fetch: ProviderFetch;
  now: ProviderClock;
}>;

const PROVIDER_CONTROL_REQUEST_TIMEOUT_MS = 15_000;

export function providerFetch(
  dependencies: AdapterDependencies,
  input: string | URL | Request,
  init: RequestInit = {},
) {
  return dependencies.fetch(input, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(PROVIDER_CONTROL_REQUEST_TIMEOUT_MS),
  });
}

export function formBody(values: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) body.set(key, value);
  }
  return body;
}

export function expiresAtMs(now: number, expiresIn: unknown, fallbackSeconds = 3600): number {
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : fallbackSeconds;
  return now + Math.floor(seconds * 1000);
}

export function grantedScopes(
  value: unknown,
  fallback: readonly string[],
  required: readonly string[] = fallback,
): readonly string[] {
  const source = typeof value === "string"
    ? value.split(/[\s,]+/)
    : fallback;
  const granted = [...new Set(source.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (typeof value === "string") {
    const grantedSet = new Set(granted);
    const missing = required.filter((scope) => !grantedSet.has(scope));
    if (missing.length > 0) {
      throw new ProviderProtocolError({
        code: "PROVIDER_REQUIRED_SCOPE_MISSING",
        category: "authorization",
        message: "The provider grant is missing a required scope",
      });
    }
  }
  return granted;
}

export function revocationMaterialFromBundle(
  bundle: ProviderTokenBundle,
): ProviderRevocationMaterial {
  if (bundle.product === "codex") {
    return { product: bundle.product, refreshToken: bundle.refreshToken };
  }
  if (bundle.product === "xai") {
    return { product: bundle.product, refreshToken: bundle.refreshToken };
  }
  return { product: bundle.product, sourceAccessToken: bundle.sourceAccessToken };
}

export function sameRevocationMaterial(
  left: ProviderRevocationMaterial,
  right: ProviderRevocationMaterial,
) {
  if (left.product !== right.product) return false;
  if (left.product === "github_copilot" && right.product === "github_copilot") {
    return left.sourceAccessToken === right.sourceAccessToken;
  }
  if (left.product !== "github_copilot" && right.product !== "github_copilot") {
    return left.refreshToken === right.refreshToken;
  }
  return false;
}

export function assertProduct(
  expected: ProviderProductKind,
  actual: ProviderProductKind,
): void {
  if (expected !== actual) {
    throw new ProviderProtocolError({
      code: "PROVIDER_PRODUCT_MISMATCH",
      category: "protocol",
      message: "The protocol input belongs to a different provider product",
    });
  }
}

export function invalidGrantStatus(status: number, errorCode: string | undefined): boolean {
  return (
    status === 401 ||
    status === 403 ||
    errorCode === "invalid_grant" ||
    errorCode === "invalid_token" ||
    errorCode === "refresh_token_expired" ||
    errorCode === "refresh_token_reused" ||
    errorCode === "refresh_token_invalidated"
  );
}
