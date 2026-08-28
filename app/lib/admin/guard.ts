// [Input] Admin session cookies, permission codes, request identifiers, and mutation Origin headers.
// [Output] Fail-closed Admin authentication/RBAC/Origin guards shared by route handlers.
// [Pos] Server-side Admin trust boundary; missing mutation Origin is always denied.
// [Sync] 2026-08-27: remove the NODE_ENV exception for Origin-less mutations.

import { randomUUID } from "node:crypto";
import {
  ADMIN_SESSION_COOKIE,
  getAdminIdentityFromToken,
  hasAdminPermission,
  parseCookie,
} from "./session";
import { AdminError } from "./errors";

export function adminRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : `admin_${randomUUID().replaceAll("-", "")}`;
}

export async function requireAdminRequest(
  request: Request,
  permission?: string,
) {
  let identity;
  try {
    identity = await getAdminIdentityFromToken(
      parseCookie(request.headers, ADMIN_SESSION_COOKIE),
    );
  } catch {
    throw new AdminError(
      "ADMIN_AUTH_UNAVAILABLE",
      "Admin authentication is not available",
      503,
    );
  }
  if (!identity) {
    throw new AdminError(
      "ADMIN_AUTH_REQUIRED",
      "An active admin session is required",
      401,
    );
  }
  if (permission && !hasAdminPermission(identity, permission)) {
    throw new AdminError(
      "ADMIN_PERMISSION_DENIED",
      `Permission ${permission} is required`,
      403,
    );
  }
  return identity;
}

export function assertAdminMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new AdminError(
      "ADMIN_ORIGIN_REQUIRED",
      "Admin mutations require an Origin header",
      403,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AdminError(
      "ADMIN_ORIGIN_DENIED",
      "The request Origin is not allowed",
      403,
    );
  }
  const configured = new Set(
    (process.env.ADMIN_ORIGIN_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  configured.add(new URL(request.url).origin);
  if (!configured.has(parsed.origin)) {
    throw new AdminError(
      "ADMIN_ORIGIN_DENIED",
      "The request Origin is not allowed",
      403,
    );
  }
}
