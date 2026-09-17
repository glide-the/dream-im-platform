// [Input] Installed-provider signed query, exact auth configuration and registered OAuth client.
// [Output] Safe consent display context and restricted local login return.
// [Pos] Auth UI context validation; actual grants remain independently verified by Better Auth.
// [Sync] 2026-09-14: reuse public Better Auth signing primitives; no alternate OAuth issuance.
import { makeSignature, constantTimeEqual } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { oauthClient } from "@ink-memory/db/schema/auth-generated";
import { AuthBoundaryError, authConfiguration, authScopes } from "./config";
import { withAuthTransaction } from "./database";
export function searchParamsFromPage(input: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  return query;
}
export function localLoginReturn(query: URLSearchParams) {
  const candidate = query.get("return_to");
  if (candidate === "/admin") return candidate;
  if (candidate?.startsWith("/auth/device?")) {
    const params = new URLSearchParams(candidate.slice("/auth/device?".length));
    const code = params.get("user_code");
    if (params.size === 1 && code && /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code)) return `/auth/device?${new URLSearchParams({ user_code: code }).toString()}`;
  }
  return "/admin";
}
// Installed source utils-D4G5zf06.mjs signs sorted key/value query entries.
// This UI check rejects misleading context before display. The provider still
// verifies the signed query on sign-in/consent and enforces the registered grant.
export async function validConsentQuery(query: URLSearchParams, secret: string, now = Date.now()) {
  const signatures = query.getAll("sig"), expiry = Number(query.get("exp"));
  if (signatures.length !== 1 || !signatures[0] || !Number.isSafeInteger(expiry) || expiry * 1_000 < now) return false;
  const unsigned = new URLSearchParams(query); unsigned.delete("sig");
  const canonical = new URLSearchParams([...unsigned.entries()].sort(([ka, va], [kb, vb]) => ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0));
  return constantTimeEqual(signatures[0], await makeSignature(canonical.toString(), secret));
}
export async function readConsentContext(query: URLSearchParams) {
  const config = authConfiguration();
  if (!await validConsentQuery(query, config.secret) || query.getAll("client_id").length !== 1 || query.getAll("scope").length !== 1 || query.getAll("resource").some(resource => resource !== config.resource)) throw new AuthBoundaryError("AUTH_CONTEXT_INVALID", 400);
  return withAuthTransaction(async tx => {
    const rows = await tx.select({ id: oauthClient.clientId, name: oauthClient.name, disabled: oauthClient.disabled, scopes: oauthClient.scopes, redirects: oauthClient.redirectUris }).from(oauthClient).where(eq(oauthClient.clientId, query.get("client_id")!)).limit(1);
    const client = rows[0]; const scopes = query.get("scope")!.split(/\s+/).filter(Boolean);
    if (!client || client.disabled || !client.redirects.includes(query.get("redirect_uri") ?? "") || scopes.some(scope => !authScopes.includes(scope as typeof authScopes[number]) || !client.scopes?.includes(scope))) throw new AuthBoundaryError("AUTH_CONTEXT_INVALID", 400);
    return { clientName: client.name ?? client.id, scopes, resource: config.resource };
  });
}
