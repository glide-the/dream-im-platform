// [Input] Domain-level auth requests/results, independent of Drizzle identity entities.
// [Output] Strict v1 request/response schemas with decimal IDs and ISO8601 timestamps.
// [Pos] Cross-project DTO contract; Dream consumes only these projections.
// [Sync] 2026-09-14: define exact principal/handle/capability and recovery shapes.
import { z } from "zod";

export const requestIdDto = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const decimalIdDto = z.string().regex(/^[1-9]\d{0,18}$/).refine(value => BigInt(value) <= 9_223_372_036_854_775_807n);
export const isoTimeDto = z.iso.datetime({ offset: true });
export const principalDto = z.strictObject({
  subject: z.string().min(1).max(160), canonical_user_id: decimalIdDto,
  client_id: z.string().min(1).max(160), scopes: z.array(z.string()), status: z.literal("active"),
});
export type PrincipalDto = z.infer<typeof principalDto>;

export const browserExchangeDto = z.strictObject({
  request_id: requestIdDto, transaction_id: requestIdDto,
  code: z.string().min(1).max(2_048), code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/), redirect_uri: z.string().min(1).max(2_048),
});
export const browserHandleDto = z.strictObject({ request_id: requestIdDto, handle: z.string().regex(/^dbr_[A-Za-z0-9_-]{43}$/) });
export const browserExchangeResultDto = z.strictObject({ handle: browserHandleDto.shape.handle, expires_at: isoTimeDto });
export const browserResolveResultDto = z.strictObject({ access_token: z.string().min(1), expires_at: isoTimeDto, principal: principalDto });
export const browserRevokeResultDto = z.strictObject({ revoked: z.literal(true) });

export const oauthTokenSetDto = z.object({
  access_token: z.string().min(1), token_type: z.literal("Bearer"), expires_in: z.number().int().positive().max(300),
  refresh_token: z.string().min(1).optional(), scope: z.string().optional(),
});

export const operationCapabilityDto = z.strictObject({
  name: z.string().min(1), kind: z.enum(["read", "write"]), user_scope: z.string().nullable(), background_scope: z.string().nullable(), input_schema_version: z.literal(1), output_schema_version: z.literal(1), contract_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const capabilitiesDto = z.strictObject({
  version: z.literal("1"),
  auth: z.strictObject({ issuer: z.string(), jwks_uri: z.string(), algorithm: z.literal("ES256"), resource: z.string(), clients: z.strictObject({ browser: z.string(), device: z.string() }), scopes: z.array(z.string()), delegations: z.array(z.strictObject({ name: z.enum(["runtime-delegation.create", "runtime-delegation.renew", "runtime-delegation.revoke", "runtime-delegation.receipt"]), method: z.enum(["POST", "GET"]), path: z.string(), input_schema_version: z.literal(1), output_schema_version: z.literal(1), contract_sha256: z.string().regex(/^[0-9a-f]{64}$/) })) }),
  schema_capabilities: z.array(z.strictObject({ capability: z.string(), version: z.number().int().positive(), contract_sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
  operations: z.array(operationCapabilityDto),
});
