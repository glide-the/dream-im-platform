// [Input] Explicit Admin auth origin, Google secrets, token key and configured service clients.
// [Output] Strict single-topology authentication configuration; missing capability fails closed.
// [Pos] Server-only configuration boundary shared by auth/domain services.
// [Sync] 2026-09-17: separate delegated scopes from confidential-client background scopes.
import { z } from "zod";
import type { DreamDomainErrorDetails } from "../dream/errorDto";

export class AuthBoundaryError extends Error {
  constructor(readonly code: string, readonly status = 503, readonly details?: DreamDomainErrorDetails) {
    super(code);
  }
}

type AuthEnvironment = Record<string, string | undefined>;

export function requiredAuthValue(name: string, environment: AuthEnvironment = process.env): string {
  const value = environment[name]?.trim();
  if (!value) throw new AuthBoundaryError("AUTH_NOT_CONFIGURED");
  return value;
}

export function exactAuthUrl(value: string, originOnly = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthBoundaryError("AUTH_INVALID_URL"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      (originOnly && url.pathname !== "/")) throw new AuthBoundaryError("AUTH_INVALID_URL");
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}

export const authScopes = ["openid", "profile", "email", "offline_access", "dream:read", "dream:write", "editor:read", "editor:write", "product:read", "product:write", "messages:create", "messages:count_tokens", "models:list"] as const;
export const backgroundAuthScopes = ["capabilities:read", "resource-policy:read", "resource-observer:write", "connectors:sync", "plugins:catalog", "reflections:execute", "story-confirmation:dispatch"] as const;
export const oauthProviderScopes = [...authScopes, ...backgroundAuthScopes] as const;
export const accessTokenLifetimeSeconds = 300;

const serviceClientSchema = z.strictObject({
  id: z.string().min(1).max(160),
  secret: z.string().min(32),
  origin: z.string(),
  oauthClientId: z.string().min(1).max(160),
  redirectUri: z.string(),
  backgroundScopes: z.array(z.enum(backgroundAuthScopes)).min(1),
});

export type DreamServiceClient = z.infer<typeof serviceClientSchema>;

export function dreamServiceClients(environment: AuthEnvironment = process.env): DreamServiceClient[] {
  let parsed: unknown;
  try { parsed = JSON.parse(requiredAuthValue("DREAM_DATA_SERVICE_CLIENTS", environment)); }
  catch { throw new AuthBoundaryError("AUTH_NOT_CONFIGURED"); }
  const result = z.array(serviceClientSchema).min(1).safeParse(parsed);
  if (!result.success || new Set(result.data.map(x => x.id)).size !== result.data.length) throw new AuthBoundaryError("AUTH_NOT_CONFIGURED");
  return result.data.map(client => {
    const origin = exactAuthUrl(client.origin, true);
    const redirectUri = exactAuthUrl(client.redirectUri);
    if (new URL(redirectUri).origin !== origin) throw new AuthBoundaryError("AUTH_INVALID_REDIRECT");
    return { ...client, origin, redirectUri };
  });
}

export function authConfiguration(environment: AuthEnvironment = process.env) {
  const issuer = exactAuthUrl(requiredAuthValue("BETTER_AUTH_URL", environment));
  if (new URL(issuer).pathname !== "/api/auth") throw new AuthBoundaryError("AUTH_INVALID_ISSUER");
  const secret = requiredAuthValue("BETTER_AUTH_SECRET", environment);
  if (Buffer.byteLength(secret) < 32) throw new AuthBoundaryError("AUTH_NOT_CONFIGURED");
  const origins = requiredAuthValue("AUTH_TRUSTED_ORIGINS", environment).split(",").map(x => exactAuthUrl(x.trim(), true));
  const origin = new URL(issuer).origin;
  if (!origins.includes(origin)) throw new AuthBoundaryError("AUTH_INVALID_ORIGIN");
  return {
    issuer, origin, secret, origins,
    resource: exactAuthUrl(requiredAuthValue("DREAM_API_RESOURCE", environment)),
    googleClientId: requiredAuthValue("GOOGLE_CLIENT_ID", environment),
    googleClientSecret: requiredAuthValue("GOOGLE_CLIENT_SECRET", environment),
    secureCookies: new URL(issuer).protocol === "https:",
  };
}
