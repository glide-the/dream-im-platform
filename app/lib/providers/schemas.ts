// [Input] Untrusted decrypted provider envelopes and serialized device-flow state.
// [Output] Strict parse-compatible Zod schemas for the shared protocol unions.
// [Pos] Runtime validation boundary between persistence/orchestration code and provider adapters.
// [Sync] 2026-09-04: publish device-flow and token-bundle schemas without owning encryption.

import { z } from "zod";

const nonEmptySecretSchema = z.string().min(1).max(32_768);
const expiresAtSchema = z.number().int().nonnegative();
const grantedScopesSchema = z.array(z.string().trim().min(1).max(256)).max(64);

export const deviceFlowStateSchema = z.discriminatedUnion("product", [
  z.strictObject({
    product: z.literal("codex"),
    deviceCode: nonEmptySecretSchema,
    userCode: z.string().min(1).max(256),
    verificationUri: z.string().url(),
    verificationUriComplete: z.string().url().optional(),
    expiresInSeconds: z.number().positive().max(86_400),
    intervalSeconds: z.number().positive().max(300),
  }),
  z.strictObject({
    product: z.literal("xai"),
    deviceCode: nonEmptySecretSchema,
    userCode: z.string().min(1).max(256),
    verificationUri: z.string().url(),
    verificationUriComplete: z.string().url().optional(),
    expiresInSeconds: z.number().positive().max(86_400),
    intervalSeconds: z.number().positive().max(300),
  }),
  z.strictObject({
    product: z.literal("github_copilot"),
    deviceCode: nonEmptySecretSchema,
    userCode: z.string().min(1).max(256),
    verificationUri: z.string().url(),
    verificationUriComplete: z.string().url().optional(),
    expiresInSeconds: z.number().positive().max(86_400),
    intervalSeconds: z.number().positive().max(300),
  }),
]);

export const providerTokenBundleSchema = z.discriminatedUnion("product", [
  z.strictObject({
    product: z.literal("codex"),
    accessToken: nonEmptySecretSchema,
    refreshToken: nonEmptySecretSchema,
    idToken: nonEmptySecretSchema.optional(),
    expiresAtMs: expiresAtSchema,
    grantedScopes: grantedScopesSchema,
    identity: z.strictObject({
      subject: z.string().min(1).max(1_024),
      chatgptAccountId: z.string().min(1).max(1_024),
    }),
  }),
  z.strictObject({
    product: z.literal("xai"),
    accessToken: nonEmptySecretSchema,
    refreshToken: nonEmptySecretSchema,
    idToken: nonEmptySecretSchema.optional(),
    expiresAtMs: expiresAtSchema,
    grantedScopes: grantedScopesSchema,
    identity: z.strictObject({ subject: z.string().min(1).max(1_024) }),
  }),
  z.strictObject({
    product: z.literal("github_copilot"),
    sourceAccessToken: nonEmptySecretSchema,
    sourceRefreshToken: nonEmptySecretSchema.optional(),
    sourceExpiresAtMs: expiresAtSchema.optional(),
    copilotAccessToken: nonEmptySecretSchema,
    copilotExpiresAtMs: expiresAtSchema,
    grantedScopes: grantedScopesSchema,
    identity: z.strictObject({
      numericId: z.number().int().positive().safe(),
      login: z.string().min(1).max(256),
    }),
  }),
]);

export const providerRevocationMaterialSchema = z.discriminatedUnion("product", [
  z.strictObject({
    product: z.literal("codex"),
    refreshToken: nonEmptySecretSchema,
  }),
  z.strictObject({
    product: z.literal("xai"),
    refreshToken: nonEmptySecretSchema,
  }),
  z.strictObject({
    product: z.literal("github_copilot"),
    sourceAccessToken: nonEmptySecretSchema,
  }),
]);
