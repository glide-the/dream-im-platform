// [Input] Strict canonical-subject target DTO, one-time current-key proof and an Admin-owned Drizzle transaction.
// [Output] Redacted drift plan or one atomic Gateway service-key rotation with an audit record.
// [Pos] Gateway control-plane domain boundary; plaintext keys never enter DTOs, database rows or receipts.
// [Sync] 2026-09-17: support explicit audited emergency rotation when scopes are unchanged.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { adminAuditLogs, gatewayApiKeys } from "@ink-memory/db/schema";
import type { DataRepositoryDatabase } from "../dream/database";
import { createGatewayApiKey, hashGatewayApiKey } from "./api-keys";
import { createPlatformId } from "../platform-ids";

export const canonicalGatewayScopeDto = z.enum([
  "messages:create",
  "messages:count_tokens",
  "models:list",
]);

export const gatewayServiceKeyTargetDto = z.strictObject({
  serviceClientId: z.string().trim().min(1).max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  scopes: z.array(canonicalGatewayScopeDto).min(1).max(3)
    .refine(scopes => new Set(scopes).size === scopes.length, "Scopes must be unique"),
  requestId: z.string().trim().min(8).max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  force: z.boolean().optional().default(false),
});
export type GatewayServiceKeyTargetDto = z.infer<typeof gatewayServiceKeyTargetDto>;

export const gatewayServiceKeyPlanDto = z.strictObject({
  serviceClientId: z.string(),
  action: z.enum(["unchanged", "rotate"]),
  currentScopes: z.array(z.string()),
  targetScopes: z.array(canonicalGatewayScopeDto),
  currentKeyMatchesSecret: z.boolean(),
});
export type GatewayServiceKeyPlanDto = z.infer<typeof gatewayServiceKeyPlanDto>;

type CurrentGatewayKey = {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  expiresAt: Date | null;
};

export class GatewayServiceKeyRotationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GatewayServiceKeyRotationError";
  }
}

export class GatewayServiceKeyRepository {
  constructor(private readonly database: DataRepositoryDatabase) {}

  async current(serviceClientId: string, lock = false): Promise<CurrentGatewayKey | null> {
    const query = this.database.select({
      id: gatewayApiKeys.id,
      name: gatewayApiKeys.name,
      keyPrefix: gatewayApiKeys.key_prefix,
      keyHash: gatewayApiKeys.key_hash,
      scopes: gatewayApiKeys.scopes,
      expiresAt: gatewayApiKeys.expires_at,
    }).from(gatewayApiKeys).where(and(
      eq(gatewayApiKeys.service_client_id, serviceClientId),
      eq(gatewayApiKeys.subject_mode, "canonical_subject"),
      eq(gatewayApiKeys.status, "active"),
      isNull(gatewayApiKeys.revoked_at),
    )).limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0] ?? null;
  }

  async revoke(id: string, revokedAt: Date) {
    const rows = await this.database.update(gatewayApiKeys).set({
      status: "revoked",
      revoked_at: revokedAt,
    }).where(and(
      eq(gatewayApiKeys.id, id),
      eq(gatewayApiKeys.status, "active"),
      isNull(gatewayApiKeys.revoked_at),
    )).returning({ id: gatewayApiKeys.id });
    if (rows.length !== 1) throw new GatewayServiceKeyRotationError("GATEWAY_SERVICE_KEY_CONFLICT");
  }

  async create(input: {
    id: string;
    serviceClientId: string;
    name: string;
    prefix: string;
    hash: string;
    scopes: string[];
    expiresAt: Date | null;
  }) {
    await this.database.insert(gatewayApiKeys).values({
      id: input.id,
      platform_user_id: null,
      subject_mode: "canonical_subject",
      service_client_id: input.serviceClientId,
      name: input.name,
      key_prefix: input.prefix,
      key_hash: input.hash,
      scopes: input.scopes,
      status: "active",
      expires_at: input.expiresAt,
      revoked_at: null,
    });
  }

  async audit(input: {
    requestId: string;
    serviceClientId: string;
    previousId: string;
    nextId: string;
    previousScopes: string[];
    nextScopes: string[];
  }) {
    await this.database.insert(adminAuditLogs).values({
      id: `audit_${randomUUID().replaceAll("-", "")}`,
      actor_type: "release-operator",
      actor_id: input.serviceClientId,
      action: "gateway.service-key.rotate",
      resource_type: "gateway-api-keys",
      resource_id: input.nextId,
      request_id: input.requestId,
      before: { id: input.previousId, scopes: input.previousScopes, status: "active" },
      after: { id: input.nextId, scopes: input.nextScopes, status: "active" },
      metadata: { service_client_id: input.serviceClientId },
    });
  }
}

function sameScopes(left: readonly string[], right: readonly string[]) {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

export class GatewayServiceKeyRotationService {
  private readonly repository: GatewayServiceKeyRepository;

  constructor(private readonly database: DataRepositoryDatabase) {
    this.repository = new GatewayServiceKeyRepository(database);
  }

  async plan(rawTarget: unknown, currentPlaintextKey: string): Promise<GatewayServiceKeyPlanDto> {
    const target = gatewayServiceKeyTargetDto.parse(rawTarget);
    const current = await this.repository.current(target.serviceClientId);
    if (!current) throw new GatewayServiceKeyRotationError("GATEWAY_SERVICE_KEY_NOT_FOUND");
    const proofMatches = hashGatewayApiKey(currentPlaintextKey) === current.keyHash;
    return gatewayServiceKeyPlanDto.parse({
      serviceClientId: target.serviceClientId,
      action: !target.force && sameScopes(current.scopes, target.scopes) ? "unchanged" : "rotate",
      currentScopes: current.scopes,
      targetScopes: target.scopes,
      currentKeyMatchesSecret: proofMatches,
    });
  }

  async rotate(rawTarget: unknown, currentPlaintextKey: string) {
    const target = gatewayServiceKeyTargetDto.parse(rawTarget);
    const current = await this.repository.current(target.serviceClientId, true);
    if (!current) throw new GatewayServiceKeyRotationError("GATEWAY_SERVICE_KEY_NOT_FOUND");
    if (hashGatewayApiKey(currentPlaintextKey) !== current.keyHash) {
      throw new GatewayServiceKeyRotationError("GATEWAY_SERVICE_KEY_SECRET_MISMATCH");
    }
    if (!target.force && sameScopes(current.scopes, target.scopes)) {
      return {
        receipt: gatewayServiceKeyPlanDto.parse({
          serviceClientId: target.serviceClientId,
          action: "unchanged",
          currentScopes: current.scopes,
          targetScopes: target.scopes,
          currentKeyMatchesSecret: true,
        }),
        plaintextKey: null,
      };
    }
    const generated = createGatewayApiKey();
    const nextId = createPlatformId("gkey");
    const now = new Date();
    await this.repository.revoke(current.id, now);
    await this.repository.create({
      id: nextId,
      serviceClientId: target.serviceClientId,
      name: current.name,
      prefix: generated.prefix,
      hash: generated.hash,
      scopes: target.scopes,
      expiresAt: current.expiresAt,
    });
    await this.repository.audit({
      requestId: target.requestId,
      serviceClientId: target.serviceClientId,
      previousId: current.id,
      nextId,
      previousScopes: current.scopes,
      nextScopes: target.scopes,
    });
    return {
      receipt: gatewayServiceKeyPlanDto.parse({
        serviceClientId: target.serviceClientId,
        action: "rotate",
        currentScopes: current.scopes,
        targetScopes: target.scopes,
        currentKeyMatchesSecret: true,
      }),
      plaintextKey: generated.plaintext,
    };
  }
}
