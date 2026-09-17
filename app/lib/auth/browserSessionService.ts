// [Input] Validated BFF exchange/handle DTO, authenticated service binding and identity ORM transaction.
// [Output] Opaque handle or server-only token projection, with serialized refresh and transaction recovery.
// [Pos] Browser-session domain service; ciphertext/entities never cross the public DTO boundary.
// [Sync] 2026-09-14: code exchange and handle receipt commit together; failed refresh commits login-required state.
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AuthBoundaryError, authConfiguration, requiredAuthValue, type DreamServiceClient } from "./config";
import { browserExchangeDto, browserExchangeResultDto, browserResolveResultDto, oauthTokenSetDto, principalDto } from "./dto";
import { BrowserSessionRepository } from "./browserSessionRepository";
import { SubjectRepository } from "./subjectRepository";
import { adminPublicKeys, verifyAdminAccessToken } from "./accessToken";
import { decryptAuthBundle, encryptAuthBundle } from "./tokenEncryption";
import { handleAuthOnTransaction } from "./server";
import type { AuthTransaction } from "./database";

const bundleDto = z.strictObject({
  handle: z.string(), service_client_id: z.string(), origin: z.string(), oauth_client_id: z.string(),
  subject: z.string(), tokens: oauthTokenSetDto, access_expires_at: z.iso.datetime({ offset: true }),
});
type TokenSet = z.infer<typeof oauthTokenSetDto>;
type DomainResult<T> = { data: T; error?: never } | { error: AuthBoundaryError; data?: never };
type OAuthExchange = (parameters: Record<string, string>) => Promise<DomainResult<TokenSet>>;
export function handleHash(handle: string) { return createHash("sha256").update(handle).digest("hex"); }

async function callOAuthToken(tx: AuthTransaction, service: DreamServiceClient, parameters: Record<string, string>): Promise<DomainResult<TokenSet>> {
  const configuration = authConfiguration();
  const request = new Request(`${configuration.issuer}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...parameters, client_id: service.oauthClientId, resource: configuration.resource }) });
  const response = await handleAuthOnTransaction(request, tx);
  if (!response.ok) return { error: new AuthBoundaryError("BROWSER_LOGIN_REQUIRED", 401) };
  const parsed = oauthTokenSetDto.safeParse(await response.json());
  if (!parsed.success) throw new AuthBoundaryError("AUTH_TOKEN_RESPONSE_INVALID");
  return { data: parsed.data };
}

export async function principalForAccessToken(tx: AuthTransaction, token: string, requiredScope = "dream:read") {
  const configuration = authConfiguration();
  const verified = await verifyAdminAccessToken(new Headers({ authorization: `Bearer ${token}` }), requiredScope, { configuration, keys: await adminPublicKeys(tx) });
  const identity = await new SubjectRepository(tx).findActive(verified.subject);
  if (!identity) throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
  return principalDto.parse({ subject: verified.subject, canonical_user_id: identity.canonicalUserId.toString(), client_id: verified.clientId, scopes: verified.scopes, status: "active" });
}

export class BrowserSessionService {
  private readonly repository: BrowserSessionRepository;
  private readonly exchangeOAuth: OAuthExchange;
  constructor(private readonly tx: AuthTransaction, private readonly service: DreamServiceClient, exchangeOAuth?: OAuthExchange) {
    this.repository = new BrowserSessionRepository(tx, service);
    this.exchangeOAuth = exchangeOAuth ?? (parameters => callOAuthToken(tx, service, parameters));
  }

  async exchange(input: z.infer<typeof browserExchangeDto>): Promise<DomainResult<z.infer<typeof browserExchangeResultDto>>> {
    if (input.redirect_uri !== this.service.redirectUri) throw new AuthBoundaryError("AUTH_REDIRECT_DENIED", 403);
    const fingerprint = handleHash(JSON.stringify({ transaction_id: input.transaction_id, code: input.code, code_verifier: input.code_verifier, redirect_uri: input.redirect_uri }));
    const lockKey = handleHash(`${this.service.id}:${input.transaction_id}`);
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const prior = await this.repository.findTransaction(input.transaction_id);
    if (prior) {
      if (prior.inputSha256 !== fingerprint) throw new AuthBoundaryError("BROWSER_TRANSACTION_CONFLICT", 409);
      if (prior.status !== "active" || prior.expiresAt <= new Date()) return { error: new AuthBoundaryError("BROWSER_LOGIN_REQUIRED", 401) };
      const stored = this.decode(prior.tokenCiphertext);
      return { data: browserExchangeResultDto.parse({ handle: stored.handle, expires_at: prior.expiresAt.toISOString() }) };
    }
    const result = await this.exchangeOAuth({ grant_type: "authorization_code", code: input.code, code_verifier: input.code_verifier, redirect_uri: input.redirect_uri });
    if (result.error) return { error: result.error };
    const principal = await principalForAccessToken(this.tx, result.data.access_token);
    if (principal.client_id !== this.service.oauthClientId) throw new AuthBoundaryError("BROWSER_CLIENT_DENIED", 403);
    const handle = `dbr_${randomBytes(32).toString("base64url")}`;
    const lifetime = Number(requiredAuthValue("AUTH_BROWSER_SESSION_TTL_SECONDS"));
    if (!Number.isSafeInteger(lifetime) || lifetime < 1 || !Number.isFinite(new Date(Date.now() + lifetime * 1_000).getTime())) throw new AuthBoundaryError("AUTH_SESSION_POLICY_INVALID");
    const expiresAt = new Date(Date.now() + lifetime * 1_000);
    const tokenCiphertext = encryptAuthBundle({ handle, service_client_id: this.service.id, origin: this.service.origin, oauth_client_id: this.service.oauthClientId, subject: principal.subject, tokens: result.data, access_expires_at: new Date(Date.now() + result.data.expires_in * 1_000).toISOString() });
    await this.repository.create({ handleHash: handleHash(handle), authUserId: principal.subject, transactionId: input.transaction_id, inputSha256: fingerprint, tokenCiphertext, expiresAt });
    return { data: browserExchangeResultDto.parse({ handle, expires_at: expiresAt.toISOString() }) };
  }

  private decode(ciphertext: string) {
    const bundle = bundleDto.parse(decryptAuthBundle(ciphertext));
    if (bundle.service_client_id !== this.service.id || bundle.origin !== this.service.origin || bundle.oauth_client_id !== this.service.oauthClientId) throw new AuthBoundaryError("BROWSER_CLIENT_DENIED", 403);
    return bundle;
  }

  async resolve(handle: string): Promise<DomainResult<z.infer<typeof browserResolveResultDto>>> {
    const hash = handleHash(handle);
    const row = await this.repository.lockHandle(hash);
    if (!row || row.status !== "active" || row.expiresAt <= new Date()) return { error: new AuthBoundaryError("BROWSER_LOGIN_REQUIRED", 401) };
    const bundle = this.decode(row.tokenCiphertext);
    if (bundle.handle !== handle || bundle.subject !== row.authUserId) throw new AuthBoundaryError("BROWSER_CLIENT_DENIED", 403);
    if (!await new SubjectRepository(this.tx).findActive(row.authUserId)) {
      await this.repository.setStatus(hash, "login_required");
      return { error: new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403) };
    }
    const refreshSkew = Number(process.env.AUTH_REFRESH_SKEW_SECONDS ?? 30);
    if (!Number.isSafeInteger(refreshSkew) || refreshSkew < 0 || refreshSkew >= 300) throw new AuthBoundaryError("AUTH_SESSION_POLICY_INVALID");
    if (new Date(bundle.access_expires_at).getTime() <= Date.now() + refreshSkew * 1_000) {
      if (!bundle.tokens.refresh_token) { await this.repository.setStatus(hash, "login_required"); return { error: new AuthBoundaryError("BROWSER_LOGIN_REQUIRED", 401) }; }
      const refreshed = await this.exchangeOAuth({ grant_type: "refresh_token", refresh_token: bundle.tokens.refresh_token });
      if (refreshed.error) { await this.repository.setStatus(hash, "login_required"); return { error: refreshed.error }; }
      bundle.tokens = refreshed.data;
      bundle.access_expires_at = new Date(Date.now() + refreshed.data.expires_in * 1_000).toISOString();
      await this.repository.updateTokens(hash, encryptAuthBundle(bundle));
    }
    const principal = await principalForAccessToken(this.tx, bundle.tokens.access_token);
    if (principal.subject !== bundle.subject || principal.client_id !== this.service.oauthClientId) throw new AuthBoundaryError("BROWSER_CLIENT_DENIED", 403);
    return { data: browserResolveResultDto.parse({ access_token: bundle.tokens.access_token, expires_at: bundle.access_expires_at, principal }) };
  }

  async revoke(handle: string) {
    const hash = handleHash(handle);
    const row = await this.repository.lockHandle(hash);
    if (!row || row.status === "revoked") return { revoked: true as const };
    const bundle = this.decode(row.tokenCiphertext);
    if (bundle.tokens.refresh_token) {
      const configuration = authConfiguration();
      const response = await handleAuthOnTransaction(new Request(`${configuration.issuer}/oauth2/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.service.oauthClientId, token: bundle.tokens.refresh_token, token_type_hint: "refresh_token" }) }), this.tx);
      if (!response.ok) throw new AuthBoundaryError("AUTH_REVOKE_UNAVAILABLE");
    }
    await this.repository.setStatus(hash, "revoked");
    return { revoked: true as const };
  }
}
