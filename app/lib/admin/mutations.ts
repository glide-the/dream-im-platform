// [Input] Authenticated Admin mutation requests, strict resource schemas, and PostgreSQL transactions.
// [Output] Audited CRUD writes, including capability-gated nullable Claude Code Runtime model settings.
// [Pos] Shared Admin mutation domain; routes delegate here after Origin/RBAC checks.
// [Sync] 2026-08-28: persist positive int4 compact/context model values and fail closed before writes without 0041 capability.

import type { PoolClient } from "pg";
import { z } from "zod";
import { resolveGatewayBaseUrl } from "../gateway/public-base-url";
import { creditBillingAccountOnClient } from "../billing/repository";
import { createGatewayApiKey } from "../gateway/api-keys";
import { GatewayError } from "../gateway/errors";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { claudeCodeRuntimeCapabilityAvailable } from "../db/claude-code-runtime-capability";
import { withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { modelRequestHeadersSchema } from "../models/request-headers";
import {
  CredentialConfigurationError,
  encryptCredential,
  type EncryptedCredential,
} from "../security/credential-encryption";
import {
  handleStorySourceCreate,
  handleStorySourceDelete,
  handleStorySourceUpdate,
} from "../story-source/mutations";
import { isStorySourceResource } from "../story-source/repository";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";
import type { AdminIdentity } from "./session";
import { hashAdminPassword } from "./password";
import { CLAUDE_CODE_RUNTIME_INTEGER_MAX } from "../../../config/claude-agent-resource-policy";

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const optionalLimit = z.number().int().nonnegative().nullable().optional();
const providerConfigSchema = z
  .record(z.string(), z.unknown())
  .superRefine((config, context) => {
    if (
      config.authMode !== undefined &&
      !["x-api-key", "bearer"].includes(String(config.authMode))
    ) {
      context.addIssue({
        code: "custom",
        path: ["authMode"],
        message: "authMode must be x-api-key or bearer",
      });
    }
    if (
      config.outputTokenParam !== undefined &&
      !["max_tokens", "max_completion_tokens"].includes(
        String(config.outputTokenParam),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["outputTokenParam"],
        message:
          "outputTokenParam must be max_tokens or max_completion_tokens",
      });
    }
    if (
      config.modelCatalogMode !== undefined &&
      !["auto", "manual"].includes(String(config.modelCatalogMode))
    ) {
      context.addIssue({
        code: "custom",
        path: ["modelCatalogMode"],
        message: "modelCatalogMode must be auto or manual",
      });
    }
    if (
      config.manualModel !== undefined &&
      (typeof config.manualModel !== "string" ||
        config.manualModel.trim().length > 200)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualModel"],
        message: "manualModel must be a string of at most 200 characters",
      });
    }
    if (
      config.modelCatalogMode === "manual" &&
      (typeof config.manualModel !== "string" ||
        config.manualModel.trim().length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualModel"],
        message: "manualModel is required when model discovery is disabled",
      });
    }
  });

const providerCreateSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(["anthropic", "openai"]),
  baseUrl: z.url().max(2_000),
  apiKey: z.string().trim().min(8).max(8_000).optional(),
  status: z.enum(["active", "disabled"]).default("disabled"),
  timeoutMs: z.number().int().min(1_000).max(900_000).default(120_000),
  maxRetries: z.number().int().min(0).max(5).default(1),
  config: providerConfigSchema.default({}),
});

const providerUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.url().max(2_000).optional(),
  apiKey: z.string().trim().min(8).max(8_000).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  timeoutMs: z.number().int().min(1_000).max(900_000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  config: providerConfigSchema.optional(),
});

const modelCreateSchema = z.strictObject({
  providerId: z.string().min(1).max(100),
  code: codeSchema,
  upstreamModel: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(160),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  claudeCodeAutoCompactWindow: z.number().int().positive()
    .max(CLAUDE_CODE_RUNTIME_INTEGER_MAX).nullable().optional(),
  claudeCodeMaxContextTokens: z.number().int().positive()
    .max(CLAUDE_CODE_RUNTIME_INTEGER_MAX).nullable().optional(),
  capabilities: z.record(z.string(), z.boolean()).default({}),
  requestHeaders: modelRequestHeadersSchema.default({}),
  enabled: z.boolean().default(false),
});

const modelUpdateSchema = z.strictObject({
  upstreamModel: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  claudeCodeAutoCompactWindow: z.number().int().positive()
    .max(CLAUDE_CODE_RUNTIME_INTEGER_MAX).nullable().optional(),
  claudeCodeMaxContextTokens: z.number().int().positive()
    .max(CLAUDE_CODE_RUNTIME_INTEGER_MAX).nullable().optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  requestHeaders: modelRequestHeadersSchema.optional(),
  enabled: z.boolean().optional(),
});

const pricingCreateSchema = z.strictObject({
  modelId: z.string().min(1).max(100),
  userTier: codeSchema.default("default"),
  inputPriceMicrousdPerMillion: z.number().int().nonnegative(),
  outputPriceMicrousdPerMillion: z.number().int().nonnegative(),
  cacheReadPriceMicrousdPerMillion: z.number().int().nonnegative().default(0),
  cacheWritePriceMicrousdPerMillion: z.number().int().nonnegative().default(0),
  markupBps: z.number().int().min(0).max(100_000).default(0),
  discountBps: z.number().int().min(0).max(10_000).default(0),
  status: z.enum(["active", "disabled"]).default("active"),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable().optional(),
  replacesPricingRuleId: z.string().min(1).max(100).nullable().optional(),
});

const pricingUpdateSchema = z.strictObject({
  status: z.enum(["active", "disabled"]).optional(),
  effectiveTo: z.iso.datetime().nullable().optional(),
});

const platformUserUpdateSchema = z.strictObject({
  tier: codeSchema.optional(),
  status: z.enum(["active", "suspended", "closed"]).optional(),
  dailyTokenLimit: optionalLimit,
  monthlyTokenLimit: optionalLimit,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const userModelPermissionCreateSchema = z.strictObject({
  platformUserId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  requestsPerMinute: z.number().int().positive().nullable().optional(),
  dailyTokenLimit: optionalLimit,
  monthlyTokenLimit: optionalLimit,
});

const userModelPermissionUpdateSchema = z.strictObject({
  enabled: z.boolean().optional(),
  requestsPerMinute: z.number().int().positive().nullable().optional(),
  dailyTokenLimit: optionalLimit,
  monthlyTokenLimit: optionalLimit,
});

const gatewayKeyCommonCreateFields = {
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.enum(["messages:create", "chat:create", "models:list"]))
    .min(1),
  expiresAt: z.iso.datetime().nullable().optional(),
} as const;

export const gatewayKeyCreateSchema = z.discriminatedUnion("subjectMode", [
  z.strictObject({
    ...gatewayKeyCommonCreateFields,
    subjectMode: z.literal("fixed_user"),
    platformUserId: z.string().trim().min(1).max(100),
  }),
  z.strictObject({
    ...gatewayKeyCommonCreateFields,
    subjectMode: z.literal("canonical_subject"),
    serviceClientId: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  }),
]);

const billingAdjustmentSchema = z.strictObject({
  amountMicrousd: z.number().int().positive(),
  reason: z.string().trim().min(8).max(500),
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
});

const adminUserCreateSchema = z.strictObject({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  password: z.string().min(14).max(256),
  roleCodes: z.array(codeSchema).min(1).max(10),
});
const adminUserUpdateSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  password: z.string().min(14).max(256).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  roleCodes: z.array(codeSchema).min(1).max(10).optional(),
});
const adminRoleCreateSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).nullable().optional(),
  permissionCodes: z.array(codeSchema).min(1).max(100),
});
const adminRoleUpdateSchema = adminRoleCreateSchema
  .omit({ code: true })
  .partial()
  .strict();

async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AdminError(
      "ADMIN_JSON_INVALID",
      "The request body must contain valid JSON",
      400,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AdminError(
      "ADMIN_INPUT_INVALID",
      "The admin resource input is invalid",
      400,
      parsed.error.issues.slice(0, 5),
    );
  }
  return parsed.data;
}

function credentialColumns(encrypted?: EncryptedCredential) {
  return encrypted
    ? {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        fingerprint: encrypted.fingerprint,
      }
    : { ciphertext: null, iv: null, tag: null, fingerprint: null };
}

function pgMutationError(error: unknown) {
  if (error instanceof AdminError) return error;
  if (error instanceof GatewayError) {
    return new AdminError(error.code, error.message, error.status);
  }
  if (error instanceof CredentialConfigurationError) {
    return new AdminError(error.code, error.message, 503);
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  ) {
    return new AdminError(
      "ADMIN_RESOURCE_CONFLICT",
      "A resource with the same unique identifier already exists",
      409,
    );
  }
  return error;
}

function resolveAdminProviderBaseUrl(input: {
  protocol: "anthropic" | "openai";
  baseUrl: string;
}) {
  try {
    return resolveProviderBaseUrl(input);
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    if (error.code !== "PROVIDER_HOST_NOT_ALLOWED") {
      throw new AdminError(error.code, error.message, 400);
    }
    let hostname = "该主机";
    try {
      hostname = new URL(input.baseUrl).hostname.toLowerCase();
    } catch {
      // The original resolver already provides the safe validation failure.
    }
    throw new AdminError(
      error.code,
      `Provider Host ${hostname} 未获准。请将它加入服务端 AI_PROVIDER_HOST_ALLOWLIST 后重启 Admin。`,
      409,
      {
        hostname,
        configuration: "AI_PROVIDER_HOST_ALLOWLIST",
        restartRequired: true,
      },
    );
  }
}

async function insertProvider(
  client: PoolClient,
  input: z.infer<typeof providerCreateSchema>,
) {
  const baseUrl = resolveAdminProviderBaseUrl({
    protocol: input.protocol,
    baseUrl: input.baseUrl,
  });
  if (input.status === "active" && !input.apiKey) {
    throw new AdminError(
      "PROVIDER_CREDENTIAL_REQUIRED",
      "An active provider requires an API credential",
      400,
    );
  }
  const encrypted = input.apiKey
    ? credentialColumns(encryptCredential(input.apiKey))
    : credentialColumns();
  const id = createPlatformId("provider");
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO ai_providers (
       id, code, name, protocol, base_url,
       api_key_ciphertext, api_key_iv, api_key_tag, api_key_fingerprint,
       status, timeout_ms, max_retries, config
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
     )
     RETURNING id, code, name, protocol, base_url, status, timeout_ms,
               max_retries, api_key_fingerprint,
               (api_key_ciphertext IS NOT NULL) AS credential_configured,
               config, created_at, updated_at`,
    [
      id,
      input.code,
      input.name,
      input.protocol,
      baseUrl,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.fingerprint,
      input.status,
      input.timeoutMs,
      input.maxRetries,
      JSON.stringify(input.config),
    ],
  );
  return result.rows[0];
}

async function insertModel(
  client: PoolClient,
  input: z.infer<typeof modelCreateSchema>,
) {
  if (!await claudeCodeRuntimeCapabilityAvailable(client)) {
    throw new AdminError(
      "CLAUDE_CODE_RUNTIME_CAPABILITY_UNAVAILABLE",
      "The Claude Code Runtime model capability is unavailable",
      503,
    );
  }
  const id = createPlatformId("model");
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO ai_models (
       id, provider_id, code, upstream_model, display_name,
       context_window, max_output_tokens,
       claude_code_auto_compact_window, claude_code_max_context_tokens,
       capabilities, request_headers, enabled
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
     RETURNING id, provider_id, code, upstream_model, display_name,
               context_window, max_output_tokens,
               claude_code_auto_compact_window, claude_code_max_context_tokens,
               capabilities, request_headers, enabled,
               created_at, updated_at`,
    [
      id,
      input.providerId,
      input.code,
      input.upstreamModel,
      input.displayName,
      input.contextWindow ?? null,
      input.maxOutputTokens ?? null,
      input.claudeCodeAutoCompactWindow ?? null,
      input.claudeCodeMaxContextTokens ?? null,
      JSON.stringify(input.capabilities),
      JSON.stringify(input.requestHeaders),
      input.enabled,
    ],
  );
  return result.rows[0];
}

async function lockPricingScope(
  client: PoolClient,
  modelId: string,
  userTier: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${modelId}:${userTier}`],
  );
}

async function assertPricingWindow(
  client: PoolClient,
  input: {
    modelId: string;
    userTier: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    excludeId?: string;
  },
) {
  const overlap = await client.query(
    `SELECT 1 FROM ai_pricing_rules
     WHERE model_id = $1 AND user_tier = $2 AND status = 'active'
       AND id <> COALESCE($5, '')
       AND tstzrange(effective_from, effective_to, '[)') &&
           tstzrange($3::timestamptz, $4::timestamptz, '[)')
     LIMIT 1`,
    [
      input.modelId,
      input.userTier,
      input.effectiveFrom,
      input.effectiveTo ?? "infinity",
      input.excludeId ?? null,
    ],
  );
  if (overlap.rows[0]) {
    throw new AdminError(
      "PRICING_WINDOW_CONFLICT",
      "该模型与用户层级已有价格版本覆盖此生效时间，请晚于当前版本开始时间或检查未来价格窗口",
      409,
    );
  }
}

async function loadOpenPricingRuleForReplacement(
  client: PoolClient,
  input: z.infer<typeof pricingCreateSchema>,
) {
  if (input.replacesPricingRuleId) {
    return await loadRowForUpdate(
      client,
      "ai_pricing_rules",
      input.replacesPricingRuleId,
    );
  }
  if (input.status !== "active") return undefined;
  const current = await client.query<Record<string, unknown>>(
    `SELECT * FROM ai_pricing_rules
     WHERE model_id = $1 AND user_tier = $2
       AND status = 'active' AND effective_to IS NULL
     ORDER BY effective_from DESC
     LIMIT 2
     FOR UPDATE`,
    [input.modelId, input.userTier],
  );
  if (current.rows.length > 1) {
    throw new AdminError(
      "PRICING_CURRENT_VERSION_AMBIGUOUS",
      "检测到多个开放的当前价格版本，请先核对并结束重复窗口",
      409,
      { pricingRuleIds: current.rows.map((row) => String(row.id)) },
    );
  }
  return current.rows[0];
}

async function insertPricing(
  client: PoolClient,
  input: z.infer<typeof pricingCreateSchema>,
) {
  if (
    input.effectiveTo &&
    new Date(input.effectiveTo) <= new Date(input.effectiveFrom)
  ) {
    throw new AdminError(
      "PRICING_WINDOW_INVALID",
      "effectiveTo must be after effectiveFrom",
      400,
    );
  }
  if (input.status === "active") {
    await lockPricingScope(client, input.modelId, input.userTier);
  }
  let replacedPricingRuleId: string | null = null;
  const replaced = await loadOpenPricingRuleForReplacement(client, input);
  if (replaced) {
    if (input.status !== "active") {
      throw new AdminError(
        "PRICING_REPLACEMENT_STATUS_INVALID",
        "只有 active 价格版本可以替换当前版本",
        409,
      );
    }
    if (
      String(replaced.model_id) !== input.modelId ||
      String(replaced.user_tier) !== input.userTier
    ) {
      throw new AdminError(
        "PRICING_REPLACEMENT_MISMATCH",
        "A pricing version can only replace a rule for the same model and user tier",
        409,
      );
    }
    if (String(replaced.status) !== "active" || replaced.effective_to) {
      throw new AdminError(
        "PRICING_REPLACEMENT_NOT_CURRENT",
        "只能替换 active 且尚未结束的当前价格版本；历史版本保持不可变",
        409,
      );
    }
    const previousFrom = new Date(
      replaced.effective_from as string | Date,
    );
    if (new Date(input.effectiveFrom) <= previousFrom) {
      throw new AdminError(
        "PRICING_REPLACEMENT_TIME_INVALID",
        `新价格版本必须晚于当前版本开始时间 ${previousFrom.toISOString()}`,
        409,
        {
          pricingRuleId: String(replaced.id),
          effectiveFrom: previousFrom.toISOString(),
        },
      );
    }
    await client.query(
      `UPDATE ai_pricing_rules
       SET effective_to = $2::timestamptz, updated_at = NOW()
       WHERE id = $1`,
      [replaced.id, input.effectiveFrom],
    );
    replacedPricingRuleId = String(replaced.id);
  }
  if (input.status === "active") await assertPricingWindow(client, input);
  const id = createPlatformId("price");
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO ai_pricing_rules (
       id, model_id, user_tier,
       input_price_microusd_per_million,
       output_price_microusd_per_million,
       cache_read_price_microusd_per_million,
       cache_write_price_microusd_per_million,
       markup_bps, discount_bps, status, effective_from, effective_to
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     ) RETURNING *`,
    [
      id,
      input.modelId,
      input.userTier,
      input.inputPriceMicrousdPerMillion,
      input.outputPriceMicrousdPerMillion,
      input.cacheReadPriceMicrousdPerMillion,
      input.cacheWritePriceMicrousdPerMillion,
      input.markupBps,
      input.discountBps,
      input.status,
      input.effectiveFrom,
      input.effectiveTo ?? null,
    ],
  );
  return {
    ...result.rows[0],
    replaced_pricing_rule_id: replacedPricingRuleId,
  };
}

export async function insertGatewayKeyOnClient(
  client: PoolClient,
  input: z.infer<typeof gatewayKeyCreateSchema>,
) {
  const generated = createGatewayApiKey();
  const id = createPlatformId("gkey");
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO gateway_api_keys (
       id, platform_user_id, subject_mode, service_client_id,
       name, key_prefix, key_hash, scopes, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, platform_user_id, subject_mode, service_client_id,
               name, key_prefix, scopes, status, expires_at, created_at`,
    [
      id,
      input.subjectMode === "fixed_user" ? input.platformUserId : null,
      input.subjectMode,
      input.subjectMode === "canonical_subject"
        ? input.serviceClientId
        : null,
      input.name,
      generated.prefix,
      generated.hash,
      input.scopes,
      input.expiresAt ?? null,
    ],
  );
  return { ...result.rows[0], plaintextKey: generated.plaintext };
}

async function insertAdminUser(
  client: PoolClient,
  input: z.infer<typeof adminUserCreateSchema>,
) {
  const uniqueRoleCodes = [...new Set(input.roleCodes)];
  const roleResult = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM admin_roles WHERE code = ANY($1::text[])`,
    [uniqueRoleCodes],
  );
  if (roleResult.rows.length !== uniqueRoleCodes.length) {
    throw new AdminError(
      "ADMIN_ROLE_NOT_FOUND",
      "One or more requested admin roles do not exist",
      400,
    );
  }
  const id = createPlatformId("admin");
  const passwordHash = await hashAdminPassword(input.password);
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO admin_users (
       id, email, display_name, password_hash, status
     ) VALUES ($1, $2, $3, $4, 'active')
     RETURNING id, email, display_name, status, last_login_at,
               created_at, updated_at`,
    [
      id,
      input.email.trim().toLowerCase(),
      input.displayName?.trim() || null,
      passwordHash,
    ],
  );
  for (const role of roleResult.rows) {
    await client.query(
      `INSERT INTO admin_user_roles (admin_user_id, role_id)
       VALUES ($1, $2)`,
      [id, role.id],
    );
  }
  return { ...result.rows[0], roles: uniqueRoleCodes.sort() };
}

async function resolvePermissionIds(
  client: PoolClient,
  permissionCodes: string[],
) {
  const uniqueCodes = [...new Set(permissionCodes)];
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM admin_permissions WHERE code = ANY($1::text[])`,
    [uniqueCodes],
  );
  if (result.rows.length !== uniqueCodes.length) {
    throw new AdminError(
      "ADMIN_PERMISSION_NOT_FOUND",
      "One or more requested permissions do not exist",
      400,
    );
  }
  return result.rows;
}

async function insertAdminRole(
  client: PoolClient,
  input: z.infer<typeof adminRoleCreateSchema>,
) {
  const permissions = await resolvePermissionIds(client, input.permissionCodes);
  const id = createPlatformId("role");
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO admin_roles (id, code, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, name, description, created_at`,
    [id, input.code, input.name, input.description ?? null],
  );
  for (const permission of permissions) {
    await client.query(
      `INSERT INTO admin_role_permissions (role_id, permission_id)
       VALUES ($1, $2)`,
      [id, permission.id],
    );
  }
  return {
    ...result.rows[0],
    permissions: permissions.map((permission) => permission.code).sort(),
  };
}

type CrudValue = Record<string, unknown>;
type FieldMap = Readonly<Record<string, { column: string; json?: boolean }>>;

const userModelPermissionFields = {
  platformUserId: { column: "platform_user_id" },
  modelId: { column: "model_id" },
  enabled: { column: "enabled" },
  requestsPerMinute: { column: "requests_per_minute" },
  dailyTokenLimit: { column: "daily_token_limit" },
  monthlyTokenLimit: { column: "monthly_token_limit" },
} as const satisfies FieldMap;

async function insertCrudRow(
  client: PoolClient,
  table: string,
  idPrefix: string,
  input: CrudValue,
  fields: FieldMap,
) {
  const entries = Object.entries(fields).filter(
    ([inputKey]) => input[inputKey] !== undefined,
  );
  const id = createPlatformId(idPrefix);
  const columns = ["id", ...entries.map(([, field]) => field.column)];
  const values = [
    id,
    ...entries.map(([inputKey, field]) =>
      field.json ? JSON.stringify(input[inputKey]) : input[inputKey],
    ),
  ];
  const placeholders = values.map((_, index) => {
    const entry = entries[index - 1];
    return `$${index + 1}${index > 0 && entry?.[1].json ? "::jsonb" : ""}`;
  });
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO ${table} (${columns.join(", ")})
     VALUES (${placeholders.join(", ")}) RETURNING *`,
    values,
  );
  return result.rows[0];
}

const insertUserModelPermission = (client: PoolClient, input: CrudValue) =>
  insertCrudRow(
    client,
    "user_model_permissions",
    "modelperm",
    input,
    userModelPermissionFields,
  );

const createConfig = {
  providers: { permission: "providers.write", schema: providerCreateSchema, insert: insertProvider },
  models: { permission: "models.write", schema: modelCreateSchema, insert: insertModel },
  "pricing-rules": { permission: "pricing.write", schema: pricingCreateSchema, insert: insertPricing },
  "user-model-permissions": { permission: "users.write", schema: userModelPermissionCreateSchema, insert: insertUserModelPermission },
  "gateway-api-keys": { permission: "gateway.keys.write", schema: gatewayKeyCreateSchema, insert: insertGatewayKeyOnClient },
  "admin-users": { permission: "access.write", schema: adminUserCreateSchema, insert: insertAdminUser },
  "admin-roles": { permission: "access.write", schema: adminRoleCreateSchema, insert: insertAdminRole },
} as const;

export async function handleAdminResourceCreate(request: Request, resource: string) {
  if (isStorySourceResource(resource)) {
    return await handleStorySourceCreate(request, resource);
  }
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const config = createConfig[resource as keyof typeof createConfig];
    if (!config) {
      throw new AdminError(
        "ADMIN_RESOURCE_READ_ONLY",
        `Admin resource ${resource} does not support creation`,
        405,
      );
    }
    const identity = await requireAdminRequest(request, config.permission);
    const input = await parseBody(request, config.schema);
    const data = await withPlatformTransaction(async (client) => {
      const created = await config.insert(client, input as never);
      await recordAdminAuditOnClient(client, {
        identity,
        action: "create",
        resourceType: resource,
        resourceId: String(created.id),
        requestId,
        request,
        after: Object.fromEntries(
          Object.entries(created).filter(([key]) => key !== "plaintextKey"),
        ),
      });
      return created;
    });
    const responseData =
      resource === "gateway-api-keys"
        ? { ...data, gatewayBaseUrl: resolveGatewayBaseUrl(request) }
        : data;
    return Response.json(
      { data: responseData },
      { status: 201, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(pgMutationError(error), requestId);
  }
}

async function loadRowForUpdate(client: PoolClient, table: string, id: string) {
  const allowed = new Set([
    "ai_providers",
    "ai_models",
    "ai_pricing_rules",
    "platform_users",
    "user_model_permissions",
    "admin_users",
    "admin_roles",
  ]);
  if (!allowed.has(table)) throw new Error("UNSAFE_ADMIN_TABLE");
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "ADMIN_RESOURCE_ITEM_NOT_FOUND",
      "The requested admin resource does not exist",
      404,
    );
  }
  return result.rows[0];
}

function addUpdate(
  updates: string[],
  values: unknown[],
  column: string,
  value: unknown,
  cast = "",
) {
  if (value === undefined) return;
  values.push(value);
  updates.push(`${column} = $${values.length}${cast}`);
}

async function updateCrudRow(
  client: PoolClient,
  table: string,
  id: string,
  input: CrudValue,
  fields: FieldMap,
) {
  const before = await loadRowForUpdate(client, table, id);
  const values: unknown[] = [id];
  const updates: string[] = [];
  for (const [inputKey, field] of Object.entries(fields)) {
    const value = input[inputKey];
    addUpdate(
      updates,
      values,
      field.column,
      value === undefined || !field.json ? value : JSON.stringify(value),
      field.json ? "::jsonb" : "",
    );
  }
  if (!updates.length) return { before, after: before };
  const result = await client.query<Record<string, unknown>>(
    `UPDATE ${table} SET ${updates.join(", ")}, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    values,
  );
  return { before, after: result.rows[0] };
}

async function updateProvider(
  client: PoolClient,
  id: string,
  input: z.infer<typeof providerUpdateSchema>,
) {
  const before = await loadRowForUpdate(client, "ai_providers", id);
  const protocol = before.protocol as "anthropic" | "openai";
  const baseUrl = input.baseUrl
    ? resolveAdminProviderBaseUrl({ protocol, baseUrl: input.baseUrl })
    : undefined;
  const encrypted = input.apiKey ? encryptCredential(input.apiKey) : undefined;
  if (
    input.status === "active" &&
    !encrypted &&
    !before.api_key_ciphertext
  ) {
    throw new AdminError(
      "PROVIDER_CREDENTIAL_REQUIRED",
      "An active provider requires an API credential",
      400,
    );
  }
  const values: unknown[] = [id];
  const updates: string[] = [];
  addUpdate(updates, values, "name", input.name);
  addUpdate(updates, values, "base_url", baseUrl);
  addUpdate(updates, values, "status", input.status);
  addUpdate(updates, values, "timeout_ms", input.timeoutMs);
  addUpdate(updates, values, "max_retries", input.maxRetries);
  addUpdate(
    updates,
    values,
    "config",
    input.config === undefined ? undefined : JSON.stringify(input.config),
    "::jsonb",
  );
  if (encrypted) {
    addUpdate(updates, values, "api_key_ciphertext", encrypted.ciphertext);
    addUpdate(updates, values, "api_key_iv", encrypted.iv);
    addUpdate(updates, values, "api_key_tag", encrypted.tag);
    addUpdate(updates, values, "api_key_fingerprint", encrypted.fingerprint);
  }
  if (!updates.length) return { before, after: before };
  const result = await client.query<Record<string, unknown>>(
    `UPDATE ai_providers SET ${updates.join(", ")}, updated_at = NOW()
     WHERE id = $1
     RETURNING id, code, name, protocol, base_url, status, timeout_ms,
               max_retries, api_key_fingerprint,
               (api_key_ciphertext IS NOT NULL) AS credential_configured,
               config, created_at, updated_at`,
    values,
  );
  return { before, after: result.rows[0] };
}

async function updateModel(
  client: PoolClient,
  id: string,
  input: z.infer<typeof modelUpdateSchema>,
) {
  if (!await claudeCodeRuntimeCapabilityAvailable(client)) {
    throw new AdminError(
      "CLAUDE_CODE_RUNTIME_CAPABILITY_UNAVAILABLE",
      "The Claude Code Runtime model capability is unavailable",
      503,
    );
  }
  const before = await loadRowForUpdate(client, "ai_models", id);
  const values: unknown[] = [id];
  const updates: string[] = [];
  addUpdate(updates, values, "upstream_model", input.upstreamModel);
  addUpdate(updates, values, "display_name", input.displayName);
  addUpdate(updates, values, "context_window", input.contextWindow);
  addUpdate(updates, values, "max_output_tokens", input.maxOutputTokens);
  addUpdate(
    updates,
    values,
    "claude_code_auto_compact_window",
    input.claudeCodeAutoCompactWindow,
  );
  addUpdate(
    updates,
    values,
    "claude_code_max_context_tokens",
    input.claudeCodeMaxContextTokens,
  );
  addUpdate(
    updates,
    values,
    "capabilities",
    input.capabilities === undefined
      ? undefined
      : JSON.stringify(input.capabilities),
    "::jsonb",
  );
  addUpdate(
    updates,
    values,
    "request_headers",
    input.requestHeaders === undefined
      ? undefined
      : JSON.stringify(input.requestHeaders),
    "::jsonb",
  );
  addUpdate(updates, values, "enabled", input.enabled);
  if (!updates.length) return { before, after: before };
  const result = await client.query<Record<string, unknown>>(
    `UPDATE ai_models SET ${updates.join(", ")}, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    values,
  );
  return { before, after: result.rows[0] };
}

async function updatePricing(
  client: PoolClient,
  id: string,
  input: z.infer<typeof pricingUpdateSchema>,
) {
  const before = await loadRowForUpdate(client, "ai_pricing_rules", id);
  const effectiveFrom = new Date(
    before.effective_from as string | Date,
  ).toISOString();
  const effectiveTo =
    input.effectiveTo === undefined
      ? before.effective_to
        ? new Date(before.effective_to as string | Date).toISOString()
        : null
      : input.effectiveTo;
  const status = input.status ?? String(before.status);
  if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    throw new AdminError(
      "PRICING_WINDOW_INVALID",
      "effectiveTo must be after effectiveFrom",
      400,
    );
  }
  if (status === "active") {
    await lockPricingScope(
      client,
      String(before.model_id),
      String(before.user_tier),
    );
    await assertPricingWindow(client, {
      modelId: String(before.model_id),
      userTier: String(before.user_tier),
      effectiveFrom,
      effectiveTo,
      excludeId: id,
    });
  }
  const values: unknown[] = [id];
  const updates: string[] = [];
  for (const [column, value] of [
    ["status", input.status],
    ["effective_to", input.effectiveTo],
  ] as const) {
    addUpdate(updates, values, column, value);
  }
  if (!updates.length) return { before, after: before };
  const result = await client.query<Record<string, unknown>>(
    `UPDATE ai_pricing_rules SET ${updates.join(", ")}, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    values,
  );
  return { before, after: result.rows[0] };
}

async function updatePlatformUser(
  client: PoolClient,
  id: string,
  input: z.infer<typeof platformUserUpdateSchema>,
) {
  const before = await loadRowForUpdate(client, "platform_users", id);
  const values: unknown[] = [id];
  const updates: string[] = [];
  addUpdate(updates, values, "tier", input.tier);
  addUpdate(updates, values, "status", input.status);
  addUpdate(updates, values, "daily_token_limit", input.dailyTokenLimit);
  addUpdate(updates, values, "monthly_token_limit", input.monthlyTokenLimit);
  addUpdate(
    updates,
    values,
    "metadata",
    input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
    "::jsonb",
  );
  if (!updates.length) return { before, after: before };
  const result = await client.query<Record<string, unknown>>(
    `UPDATE platform_users SET ${updates.join(", ")}, updated_at = NOW()
     WHERE id = $1 RETURNING id, source, external_user_id, email,
       display_name, tier, status, daily_token_limit, monthly_token_limit,
       created_at, updated_at`,
    values,
  );
  return { before, after: result.rows[0] };
}

async function resolveRoleIds(client: PoolClient, roleCodes: string[]) {
  const uniqueCodes = [...new Set(roleCodes)];
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM admin_roles WHERE code = ANY($1::text[])`,
    [uniqueCodes],
  );
  if (result.rows.length !== uniqueCodes.length) {
    throw new AdminError(
      "ADMIN_ROLE_NOT_FOUND",
      "One or more requested admin roles do not exist",
      400,
    );
  }
  return result.rows;
}

async function updateAdminUser(
  client: PoolClient,
  id: string,
  input: z.infer<typeof adminUserUpdateSchema>,
) {
  const before = await loadRowForUpdate(client, "admin_users", id);
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('active-super-admin', 0))",
  );
  const currentSuperAdmin = await client.query<{ is_super_admin: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM admin_user_roles ur
       JOIN admin_roles r ON r.id = ur.role_id
       WHERE ur.admin_user_id = $1 AND r.code = 'super_admin'
     ) AS is_super_admin`,
    [id],
  );
  const isCurrentlyActiveSuperAdmin =
    before.status === "active" &&
    currentSuperAdmin.rows[0]?.is_super_admin === true;
  const willRemainActive = (input.status ?? before.status) === "active";
  const willRemainSuperAdmin = input.roleCodes
    ? input.roleCodes.includes("super_admin")
    : currentSuperAdmin.rows[0]?.is_super_admin === true;
  if (
    isCurrentlyActiveSuperAdmin &&
    (!willRemainActive || !willRemainSuperAdmin)
  ) {
    const other = await client.query<{ count: string }>(
      `SELECT COUNT(DISTINCT u.id)::text AS count
       FROM admin_users u
       JOIN admin_user_roles ur ON ur.admin_user_id = u.id
       JOIN admin_roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.code = 'super_admin' AND u.id <> $1`,
      [id],
    );
    if (Number(other.rows[0]?.count ?? 0) < 1) {
      throw new AdminError(
        "ADMIN_LAST_SUPER_ADMIN_PROTECTED",
        "At least one active super_admin must remain",
        409,
      );
    }
  }
  const roles = input.roleCodes
    ? await resolveRoleIds(client, input.roleCodes)
    : undefined;
  const values: unknown[] = [id];
  const updates: string[] = [];
  addUpdate(updates, values, "display_name", input.displayName);
  addUpdate(updates, values, "status", input.status);
  if (input.password) {
    addUpdate(updates, values, "password_hash", await hashAdminPassword(input.password));
  }
  if (updates.length) {
    await client.query(
      `UPDATE admin_users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1`,
      values,
    );
  }
  if (roles) {
    await client.query("DELETE FROM admin_user_roles WHERE admin_user_id = $1", [id]);
    for (const role of roles) {
      await client.query(
        "INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES ($1, $2)",
        [id, role.id],
      );
    }
  }
  const result = await client.query<Record<string, unknown>>(
    `SELECT u.id, u.email, u.display_name, u.status, u.last_login_at,
            COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]) AS roles,
            u.created_at, u.updated_at
     FROM admin_users u
     LEFT JOIN admin_user_roles ur ON ur.admin_user_id = u.id
     LEFT JOIN admin_roles r ON r.id = ur.role_id
     WHERE u.id = $1 GROUP BY u.id`,
    [id],
  );
  return { before, after: result.rows[0] };
}

async function updateAdminRole(
  client: PoolClient,
  id: string,
  input: z.infer<typeof adminRoleUpdateSchema>,
) {
  const before = await loadRowForUpdate(client, "admin_roles", id);
  if (before.code === "super_admin" && input.permissionCodes) {
    throw new AdminError(
      "ADMIN_SUPER_ROLE_PROTECTED",
      "The super_admin permission set is managed by migrations",
      409,
    );
  }
  const permissions = input.permissionCodes
    ? await resolvePermissionIds(client, input.permissionCodes)
    : undefined;
  const values: unknown[] = [id];
  const updates: string[] = [];
  addUpdate(updates, values, "name", input.name);
  addUpdate(updates, values, "description", input.description);
  if (updates.length) {
    await client.query(
      `UPDATE admin_roles SET ${updates.join(", ")} WHERE id = $1`,
      values,
    );
  }
  if (permissions) {
    await client.query("DELETE FROM admin_role_permissions WHERE role_id = $1", [id]);
    for (const permission of permissions) {
      await client.query(
        "INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ($1, $2)",
        [id, permission.id],
      );
    }
  }
  const result = await client.query<Record<string, unknown>>(
    `SELECT r.id, r.code, r.name, r.description,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions,
            r.created_at
     FROM admin_roles r
     LEFT JOIN admin_role_permissions rp ON rp.role_id = r.id
     LEFT JOIN admin_permissions p ON p.id = rp.permission_id
     WHERE r.id = $1 GROUP BY r.id`,
    [id],
  );
  return { before, after: result.rows[0] };
}

const updateConfig = {
  providers: { permission: "providers.write", schema: providerUpdateSchema, update: updateProvider },
  models: { permission: "models.write", schema: modelUpdateSchema, update: updateModel },
  "pricing-rules": { permission: "pricing.write", schema: pricingUpdateSchema, update: updatePricing },
  "platform-users": { permission: "users.write", schema: platformUserUpdateSchema, update: updatePlatformUser },
  "user-model-permissions": {
    permission: "users.write",
    schema: userModelPermissionUpdateSchema,
    update: (client: PoolClient, id: string, input: CrudValue) =>
      updateCrudRow(
        client,
        "user_model_permissions",
        id,
        input,
        userModelPermissionFields,
      ),
  },
  "admin-users": { permission: "access.write", schema: adminUserUpdateSchema, update: updateAdminUser },
  "admin-roles": { permission: "access.write", schema: adminRoleUpdateSchema, update: updateAdminRole },
} as const;

export async function handleAdminResourceUpdate(
  request: Request,
  resource: string,
  id: string,
) {
  if (isStorySourceResource(resource)) {
    return await handleStorySourceUpdate(request, resource, id);
  }
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const config = updateConfig[resource as keyof typeof updateConfig];
    if (!config) {
      throw new AdminError(
        "ADMIN_RESOURCE_READ_ONLY",
        `Admin resource ${resource} does not support updates`,
        405,
      );
    }
    const identity = await requireAdminRequest(request, config.permission);
    const input = await parseBody(request, config.schema);
    const result = await withPlatformTransaction(async (client) => {
      const updated = await config.update(client, id, input as never);
      const safeBefore = Object.fromEntries(
        Object.entries(updated.before).filter(
          ([key]) => !key.startsWith("api_key_") && key !== "password_hash",
        ),
      );
      await recordAdminAuditOnClient(client, {
        identity,
        action: "update",
        resourceType: resource,
        resourceId: id,
        requestId,
        request,
        before: safeBefore,
        after: updated.after,
      });
      return updated.after;
    });
    return Response.json(
      { data: result },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(pgMutationError(error), requestId);
  }
}

export async function handleAdminResourceDelete(
  request: Request,
  resource: string,
  id: string,
) {
  if (isStorySourceResource(resource)) {
    return await handleStorySourceDelete(request, resource);
  }
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    if (resource !== "gateway-api-keys") {
      const deletable = {
        "user-model-permissions": { table: "user_model_permissions", permission: "users.write" },
        "admin-roles": { table: "admin_roles", permission: "access.write" },
      } as const;
      const config = deletable[resource as keyof typeof deletable];
      if (!config) {
        throw new AdminError(
          "ADMIN_RESOURCE_DELETE_DENIED",
          "This resource uses status transitions instead of hard deletion",
          405,
        );
      }
      const identity = await requireAdminRequest(request, config.permission);
      const data = await withPlatformTransaction(async (client) => {
        const before = await loadRowForUpdate(client, config.table, id);
        if (
          resource === "admin-roles" &&
          ["super_admin", "operator", "auditor"].includes(String(before.code))
        ) {
          throw new AdminError(
            "ADMIN_BUILTIN_ROLE_PROTECTED",
            "Built-in admin roles cannot be deleted",
            409,
          );
        }
        if (resource === "admin-roles") {
          const assignments = await client.query(
            "SELECT 1 FROM admin_user_roles WHERE role_id = $1 LIMIT 1",
            [id],
          );
          if (assignments.rows[0]) {
            throw new AdminError(
              "ADMIN_ROLE_IN_USE",
              "Remove this role from all administrators before deleting it",
              409,
            );
          }
        }
        await client.query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
        await recordAdminAuditOnClient(client, {
          identity,
          action: "delete",
          resourceType: resource,
          resourceId: id,
          requestId,
          request,
          before,
        });
        return { id };
      });
      return Response.json(
        { data },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
    const identity = await requireAdminRequest(request, "gateway.keys.write");
    const data = await withPlatformTransaction(async (client) => {
      const before = await client.query<Record<string, unknown>>(
        `SELECT id, platform_user_id, subject_mode, service_client_id,
                name, key_prefix, scopes, status, expires_at, last_used_at,
                revoked_at, created_at
         FROM gateway_api_keys WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!before.rows[0]) {
        throw new AdminError(
          "ADMIN_RESOURCE_ITEM_NOT_FOUND",
          "The Gateway API key does not exist",
          404,
        );
      }
      const result = await client.query<Record<string, unknown>>(
        `UPDATE gateway_api_keys
         SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW())
         WHERE id = $1
         RETURNING id, platform_user_id, subject_mode, service_client_id,
                   name, key_prefix, scopes, status, expires_at, last_used_at,
                   revoked_at, created_at`,
        [id],
      );
      await recordAdminAuditOnClient(client, {
        identity,
        action: "revoke",
        resourceType: resource,
        resourceId: id,
        requestId,
        request,
        before: before.rows[0],
        after: result.rows[0],
      });
      return result.rows[0];
    });
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(pgMutationError(error), requestId);
  }
}

export async function handleBillingAdjustment(
  request: Request,
  platformUserId: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "billing.adjust");
    const input = await parseBody(request, billingAdjustmentSchema);
    const result = await withPlatformTransaction(async (client) => {
      const credited = await creditBillingAccountOnClient(client, {
        platformUserId,
        amountMicrousd: input.amountMicrousd,
        idempotencyKey: `admin:${input.idempotencyKey}`,
        description: input.reason,
        actorType: "admin",
        actorId: identity.id,
      });
      await recordAdminAuditOnClient(client, {
        identity,
        action: "credit",
        resourceType: "billing-account",
        resourceId: platformUserId,
        requestId,
        request,
        after: {
          amountMicrousd: input.amountMicrousd,
          reason: input.reason,
          ledgerEntryId: credited.ledgerEntryId,
        },
      });
      return credited;
    });
    return Response.json(
      { data: result },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(pgMutationError(error), requestId);
  }
}
