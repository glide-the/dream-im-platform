// [Input] Better Auth 1.7.4 getSchema(jwt + oauthProvider + oauthDeviceAuthorization).
// [Output] Drizzle declarations for the exact installed auth protocol catalog.
// [Pos] Canonical identity schema; regenerate/review via forward migration only.
// [Sync] 2026-09-14: add installed-package schema; no runtime DDL.
import { pgSchema, text, boolean, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
export const identity = pgSchema("identity");
export const user = identity.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
  uniqueIndex("identity_user_email_idx").on(table.email),
]);
export const session = identity.table("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("identity_session_token_idx").on(table.token),
  index("identity_session_userId_idx").on(table.userId),
]);
export const account = identity.table("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
  uniqueIndex("identity_account_provider_account_uidx").on(table.providerId, table.accountId),
  index("identity_account_userId_idx").on(table.userId),
]);
export const verification = identity.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
  index("identity_verification_identifier_idx").on(table.identifier),
]);
export const jwks = identity.table("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("publicKey").notNull(),
  privateKey: text("privateKey").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  alg: text("alg"),
  crv: text("crv"),
}, (table) => [
]);
export const oauthClient = identity.table("oauthClient", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull(),
  clientSecret: text("clientSecret"),
  clientDiscoveryId: text("clientDiscoveryId"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skipConsent"),
  enableEndSession: boolean("enableEndSession"),
  subjectType: text("subjectType"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("clientCredentialsScopes").array().default([]),
  userId: text("userId").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("softwareId"),
  softwareVersion: text("softwareVersion"),
  softwareStatement: text("softwareStatement"),
  redirectUris: text("redirectUris").array().notNull(),
  postLogoutRedirectUris: text("postLogoutRedirectUris").array(),
  backchannelLogoutUri: text("backchannelLogoutUri"),
  backchannelLogoutSessionRequired: boolean("backchannelLogoutSessionRequired"),
  tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
  applicationType: text("applicationType"),
  jwks: text("jwks"),
  jwksUri: text("jwksUri"),
  grantTypes: text("grantTypes").array(),
  responseTypes: text("responseTypes").array(),
  requirePKCE: boolean("requirePKCE"),
  dpopBoundAccessTokens: boolean("dpopBoundAccessTokens").default(false),
  referenceId: text("referenceId"),
  metadata: jsonb("metadata"),
}, (table) => [
  uniqueIndex("identity_oauthClient_clientId_idx").on(table.clientId),
  index("identity_oauthClient_userId_idx").on(table.userId),
]);
export const oauthResource = identity.table("oauthResource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  name: text("name").notNull(),
  accessTokenTtl: integer("accessTokenTtl"),
  refreshTokenTtl: integer("refreshTokenTtl"),
  signingAlgorithm: text("signingAlgorithm"),
  signingKeyId: text("signingKeyId"),
  allowedScopes: text("allowedScopes").array(),
  customClaims: jsonb("customClaims"),
  dpopBoundAccessTokensRequired: boolean("dpopBoundAccessTokensRequired").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
  policyVersion: integer("policyVersion").default(1),
  metadata: jsonb("metadata"),
}, (table) => [
  uniqueIndex("identity_oauthResource_identifier_idx").on(table.identifier),
]);
export const oauthClientResource = identity.table("oauthClientResource", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  resourceId: text("resourceId").notNull().references(() => oauthResource.identifier, { onDelete: "cascade" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
}, (table) => [
  index("identity_oauthClientResource_clientId_idx").on(table.clientId),
  index("identity_oauthClientResource_resourceId_idx").on(table.resourceId),
  uniqueIndex("identity_oauthClientResource_clientId_resourceId_uidx").on(table.clientId, table.resourceId),
]);
export const oauthRefreshToken = identity.table("oauthRefreshToken", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  clientId: text("clientId").notNull().references(() => oauthClient.clientId, { onDelete: "restrict" }),
  sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "restrict" }),
  referenceId: text("referenceId"),
  authorizationCodeId: text("authorizationCodeId"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
  rotatedAt: timestamp("rotatedAt", { withTimezone: true, mode: "date" }),
  rotationReplayResponse: text("rotationReplayResponse"),
  rotationReplayExpiresAt: timestamp("rotationReplayExpiresAt", { withTimezone: true, mode: "date" }),
  authTime: timestamp("authTime", { withTimezone: true, mode: "date" }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
}, (table) => [
  uniqueIndex("identity_oauthRefreshToken_token_idx").on(table.token),
  index("identity_oauthRefreshToken_clientId_idx").on(table.clientId),
  index("identity_oauthRefreshToken_sessionId_idx").on(table.sessionId),
  index("identity_oauthRefreshToken_userId_idx").on(table.userId),
  index("identity_oauthRefreshToken_authorizationCodeId_idx").on(table.authorizationCodeId),
]);
export const oauthAccessToken = identity.table("oauthAccessToken", {
  id: text("id").primaryKey(),
  token: text("token"),
  clientId: text("clientId").notNull().references(() => oauthClient.clientId, { onDelete: "restrict" }),
  sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
  userId: text("userId").references(() => user.id, { onDelete: "restrict" }),
  referenceId: text("referenceId"),
  authorizationCodeId: text("authorizationCodeId"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
  refreshId: text("refreshId").references(() => oauthRefreshToken.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
}, (table) => [
  uniqueIndex("identity_oauthAccessToken_token_idx").on(table.token),
  index("identity_oauthAccessToken_clientId_idx").on(table.clientId),
  index("identity_oauthAccessToken_sessionId_idx").on(table.sessionId),
  index("identity_oauthAccessToken_userId_idx").on(table.userId),
  index("identity_oauthAccessToken_authorizationCodeId_idx").on(table.authorizationCodeId),
  index("identity_oauthAccessToken_refreshId_idx").on(table.refreshId),
]);
export const oauthConsent = identity.table("oauthConsent", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull().references(() => oauthClient.clientId, { onDelete: "restrict" }),
  userId: text("userId").references(() => user.id, { onDelete: "restrict" }),
  referenceId: text("referenceId"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
}, (table) => [
  index("identity_oauthConsent_clientId_idx").on(table.clientId),
  index("identity_oauthConsent_userId_idx").on(table.userId),
]);
export const oauthClientAssertion = identity.table("oauthClientAssertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
]);
export const deviceCode = identity.table("deviceCode", {
  id: text("id").primaryKey(),
  deviceCode: text("deviceCode").notNull(),
  userCode: text("userCode").notNull(),
  userId: text("userId"),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("lastPolledAt", { withTimezone: true, mode: "date" }),
  pollingInterval: integer("pollingInterval"),
  clientId: text("clientId"),
  scope: text("scope"),
  resources: text("resources").array(),
  oauthClientId: text("oauthClientId"),
}, (table) => [
  uniqueIndex("identity_deviceCode_deviceCode_uidx").on(table.deviceCode),
  uniqueIndex("identity_deviceCode_userCode_uidx").on(table.userCode),
]);
export const betterAuthSchema = { user, session, account, verification, jwks, oauthClient, oauthResource, oauthClientResource, oauthRefreshToken, oauthAccessToken, oauthConsent, oauthClientAssertion, deviceCode };
