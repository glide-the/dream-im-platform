// [Input] Admin-issued client_credentials access token and configured service client/origin/background scopes.
// [Output] Authenticated confidential-client context plus explicit user/service bearer-shape detection.
// [Pos] Internal Dream API authentication boundary.
// [Sync] 2026-09-17: replace static custom-header authentication with OAuth client_credentials tokens.
// [Sync] 2026-10-11: select only the same Browser client's published exact callback from the actual Origin.
import { AuthBoundaryError, authConfiguration, dreamServiceClients, type DreamServiceClient } from "./config";
import { verifyAdminAccessToken, type VerifiedAdminAccessToken } from "./accessToken";
import { withAuthTransaction } from "./database";
import { publishedBrowserRedirectAvailable } from "./oauthClientCatalog";

type AccessTokenVerifier = (headers: Headers) => Promise<VerifiedAdminAccessToken>;
type RedirectVerifier = (service: DreamServiceClient, redirectUri: string) => Promise<boolean>;

export async function requireDreamService(
  request: Request,
  clients = dreamServiceClients(),
  verifier: AccessTokenVerifier = headers => verifyAdminAccessToken(headers),
  redirectVerifier: RedirectVerifier = (service, redirectUri) => withAuthTransaction(tx =>
    publishedBrowserRedirectAvailable(tx, service.oauthClientId, authConfiguration().resource, redirectUri)),
): Promise<DreamServiceClient> {
  if (request.headers.has("x-ink-dream-service") || request.headers.has("x-ink-dream-credential")) throw new AuthBoundaryError("DREAM_SERVICE_REQUIRED", 401);
  const authorization = request.headers.get("x-ink-dream-service-authorization") ?? request.headers.get("authorization");
  if (!authorization) throw new AuthBoundaryError("DREAM_SERVICE_REQUIRED", 401);
  const verified = await verifier(new Headers({ authorization }));
  const configured = clients.find(client => client.id === verified.clientId);
  if (!configured || verified.subject !== verified.clientId || !verified.scopes.length
    || verified.scopes.some(scope => !configured.backgroundScopes.includes(scope as DreamServiceClient["backgroundScopes"][number]))) throw new AuthBoundaryError("DREAM_SERVICE_REQUIRED", 401);
  const overrides = ["x-user-id", "x-canonical-user-id", "x-platform-user-id", "x-external-user-id", "x-ink-user-id"];
  if (overrides.some(header => request.headers.has(header)) || ["user_id", "actor_id", "canonical_user_id"].some(key => new URL(request.url).searchParams.has(key))) throw new AuthBoundaryError("USER_OVERRIDE_FORBIDDEN", 400);
  const origin = request.headers.get("origin");
  let selected = configured;
  if (origin !== null) {
    const callback = new URL(configured.redirectUri);
    let redirectUri: string;
    try {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password) throw new Error();
      redirectUri = new URL(callback.pathname, origin).href;
    } catch { throw new AuthBoundaryError("DREAM_ORIGIN_DENIED", 403); }
    const matches = clients.filter(client => client.origin === origin);
    if (matches.length !== 1 || matches[0].redirectUri !== redirectUri
      || !await redirectVerifier(configured, redirectUri)) {
      throw new AuthBoundaryError("DREAM_ORIGIN_DENIED", 403);
    }
    selected = { ...configured, origin, redirectUri };
  }
  return { ...selected, backgroundScopes: configured.backgroundScopes.filter(scope => verified.scopes.includes(scope)) };
}

export function hasDelegatedUserBearer(request: Request): boolean {
  return request.headers.has("x-ink-dream-service-authorization");
}

export function requireBackgroundScope(service: DreamServiceClient, scope: DreamServiceClient["backgroundScopes"][number]) {
  if (!service.backgroundScopes.includes(scope)) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
}
