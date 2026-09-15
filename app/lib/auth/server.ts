// [Input] Strict auth configuration, dedicated ORM transaction and installed protocol schema.
// [Output] Admin Better Auth handler with Google, OAuth access tokens, device grant and refresh rotation.
// [Pos] Authentication composition root; Route Handlers only delegate here.
// [Sync] 2026-09-15: rethrow protocol internals to the no-log outer rollback/error boundary.
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oauthProvider, oauthDeviceAuthorization } from "@better-auth/oauth-provider";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { betterAuthSchema, deviceCode } from "@ink-memory/db/schema/auth-generated";
import { accessTokenLifetimeSeconds, authConfiguration, authScopes, AuthBoundaryError } from "./config";
import { withAuthTransaction, type AuthRepositoryDatabase, type AuthTransaction } from "./database";
import { SubjectRepository } from "./subjectRepository";
import { requiredAuthValue } from "./config";
import { oauthClient } from "@ink-memory/db/schema/auth-generated";
import { hashUnifiedPassword, productPasswordMinimumLength, verifyUnifiedPassword } from "./password";

export function createAdminAuth(database: AuthRepositoryDatabase) {
  const configuration = authConfiguration();
  const subjects = new SubjectRepository(database);
  return betterAuth({
    baseURL: configuration.issuer, basePath: "/api/auth", secret: configuration.secret,
    trustedOrigins: configuration.origins,
    database: drizzleAdapter(database, { provider: "pg", schema: betterAuthSchema, transaction: true }),
    emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: productPasswordMinimumLength, password: { hash: hashUnifiedPassword, verify: verifyUnifiedPassword } },
    socialProviders: { google: { clientId: configuration.googleClientId, clientSecret: configuration.googleClientSecret } },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false, disableImplicitLinking: true } },
    advanced: { useSecureCookies: configuration.secureCookies, defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
    disabledPaths: ["/token", "/device/token"],
    onAPIError: { throw: true },
    logger: { disabled: true },
    databaseHooks: {
      user: { create: { before: async identity => { await subjects.assertNewEmail(identity.email); } } },
      account: { create: { before: async account => {
        if (account.providerId !== "google" && account.providerId !== "credential") throw new APIError("FORBIDDEN", { code: "PROVIDER_DISABLED", message: "This provider is not enabled." });
        await subjects.linkNewAccount(account.userId, account.providerId, account.password);
      } } },
      session: { create: { before: async session => {
        if (!await subjects.findActive(session.userId) && !await subjects.hasActiveAdmin(session.userId)) throw new APIError("FORBIDDEN", { code: "ACTIVE_SUBJECT_REQUIRED", message: "An active linked account is required." });
      } } },
    },
    plugins: [
      jwt({ jwks: { keyPairConfig: { alg: "ES256" } }, jwt: { issuer: configuration.issuer, audience: configuration.resource, expirationTime: "5m" } }),
      oauthProvider({
        loginPage: "/auth/sign-in", consentPage: "/auth/consent", scopes: [...authScopes],
        resources: [{ identifier: configuration.resource, name: "Dream API", accessTokenTtl: accessTokenLifetimeSeconds, signingAlgorithm: "ES256", allowedScopes: [...authScopes] }],
        resourceSeedMode: "insertOnly", enforcePerClientResources: true,
        accessTokenExpiresIn: accessTokenLifetimeSeconds, m2mAccessTokenExpiresIn: accessTokenLifetimeSeconds,
        refreshTokenReuseInterval: 0, storeTokens: "hashed",
        allowDynamicClientRegistration: false, allowUnauthenticatedClientRegistration: false,
        clientPrivileges: async () => false, resourcePrivileges: async () => false,
      }),
      oauthDeviceAuthorization({ verificationUri: "/auth/device", validateClient: async clientId => {
        if (clientId !== requiredAuthValue("AUTH_DEVICE_CLIENT_ID")) return false;
        const rows = await database.select({ disabled: oauthClient.disabled, grants: oauthClient.grantTypes }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
        return !!rows[0] && !rows[0].disabled && !!rows[0].grants?.includes("urn:ietf:params:oauth:grant-type:device_code");
      } }),
    ],
  });
}

function oauthError(error: string, status = 400) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

// Serialize state mutation through ORM row/advisory locks. Only a SHA256 is sent
// to PostgreSQL advisory-lock hashing; credentials never appear in SQL/log text.
async function prepareProtocolRequest(request: Request, tx: AuthTransaction) {
  const path = new URL(request.url).pathname;
  const isDeviceReview = request.method === "GET" && path.endsWith("/device");
  if (request.method !== "POST" && !isDeviceReview) return;
  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown>;
  try {
    body = isDeviceReview ? Object.fromEntries(new URL(request.url).searchParams) : contentType.includes("application/json") ? await request.clone().json() : Object.fromEntries(await request.clone().formData());
  } catch { return oauthError("invalid_request"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return oauthError("invalid_request");
  if ("user_id" in body || "actor_id" in body || "canonical_user_id" in body) return oauthError("invalid_request");
  if (path.endsWith("/oauth2/token") && typeof body.refresh_token === "string") {
    const digest = createHash("sha256").update(body.refresh_token).digest("hex");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`);
  }
  const code = typeof body.device_code === "string" ? body.device_code : typeof body.user_code === "string" ? body.user_code : typeof body.userCode === "string" ? body.userCode : null;
  if (!code) return;
  const where = typeof body.device_code === "string" ? eq(deviceCode.deviceCode, code) : eq(deviceCode.userCode, code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase());
  const rows = await tx.select().from(deviceCode).where(where).for("update").limit(1);
  const record = rows[0];
  if (!record) return;
  if (path.endsWith("/oauth2/token")) {
    // Client binding is checked before polling diagnostics mutate.
    if (body.client_id !== record.oauthClientId) return oauthError("invalid_grant");
    if (record.expiresAt <= new Date()) return oauthError("expired_token");
    if (record.status === "denied") return oauthError("access_denied");
    if (record.lastPolledAt && record.pollingInterval && Date.now() - record.lastPolledAt.getTime() < record.pollingInterval) {
      await tx.update(deviceCode).set({ pollingInterval: record.pollingInterval + 5_000 }).where(and(eq(deviceCode.id, record.id), where));
      return oauthError("slow_down");
    }
  }
}

class ProtocolRollback extends Error { constructor(readonly response: Response) { super("AUTH_PROTOCOL_ROLLBACK"); } }

export async function handleAuthOnTransaction(request: Request, tx: AuthTransaction) {
  const prepared = await prepareProtocolRequest(request, tx);
  if (prepared) return prepared;
  const response = await createAdminAuth(tx).handler(request);
  if (response.status >= 500) throw new ProtocolRollback(response);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function handleAuthRequest(request: Request) {
  try {
    return await withAuthTransaction(async tx => handleAuthOnTransaction(request, tx));
  } catch (error) {
    if (error instanceof ProtocolRollback) return error.response;
    if (error instanceof AuthBoundaryError) return Response.json({ error: { code: error.code, message: "Authentication is unavailable." } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return oauthError("temporarily_unavailable", 503);
  }
}
