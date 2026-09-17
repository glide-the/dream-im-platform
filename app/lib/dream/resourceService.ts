// [Input] Authorized service background scope, validated DTO and capability-gated UOW.
// [Output] Strict policy state or persisted diagnostics receipt with ISO timestamps.
// [Pos] Resource data domain service; Dream retains LKG/refresher/admission/leases.
// [Sync] 2026-09-14: preserve invalid policy state and configured observer retention.
import { z } from "zod";
import { sql } from "drizzle-orm";
import { AuthBoundaryError, type DreamServiceClient } from "../auth/config";
import { requireBackgroundScope } from "../auth/serviceIdentity";
import { storedPolicySchema } from "../claude-agent-resource-dto";
import { ResourceRepository } from "./resourceRepository";
import { withDataTransaction } from "./database";
import { claudeAgentResourcePolicy as policy } from "../../../config/claude-agent-resource-policy";
import { resourcePolicyReadOutputDto, resourceObserverPublishInputDto, resourceObserverPublishOutputDto } from "./resourceDto";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement } from "./schemaRequirements";
export const resourcePolicyRequirements = [policy.observer, policy.claudeCodeRuntime] as const;
export const resourceObserverRequirements = [policy.observer, identitySchemaRequirement] as const;
export async function readResourcePolicy(service: DreamServiceClient) {
  requireBackgroundScope(service, "resource-policy:read");
  return withDataTransaction(resourcePolicyRequirements, async tx => {
    const row = await new ResourceRepository(tx).readPolicy();
    if (!row) return resourcePolicyReadOutputDto.parse({ status: "not_configured", value: null, updated_at: null });
    const parsed = storedPolicySchema.safeParse(row.value);
    if (!parsed.success || !row.updatedAt || !Number.isFinite(row.updatedAt.getTime())) return resourcePolicyReadOutputDto.parse({ status: "invalid", value: null, updated_at: null });
    return resourcePolicyReadOutputDto.parse({ status: "configured", value: parsed.data, updated_at: row.updatedAt.toISOString() });
  });
}
export async function publishResourceObserver(service: DreamServiceClient, input: z.infer<typeof resourceObserverPublishInputDto>, requestId: string) {
  requireBackgroundScope(service, "resource-observer:write");
  const ttlDays = Number(process.env.RESOURCE_OBSERVER_TTL_DAYS ?? 7);
  const timeout = Number(process.env.RESOURCE_OBSERVER_STATEMENT_TIMEOUT_MS ?? 900);
  if (![ttlDays, timeout].every(value => Number.isSafeInteger(value) && value > 0)) throw new AuthBoundaryError("RESOURCE_OBSERVER_POLICY_INVALID");
  return withDataTransaction(resourceObserverRequirements, async tx => {
    // Preserve the existing driver's bounded transaction behavior. This is a
    // configured statement setting, never caller SQL or a deployment-name branch.
    await tx.execute(sql`SELECT set_config('statement_timeout', ${`${timeout}ms`}, true)`);
    return new ReceiptRepository(tx, service.id, `background:${service.id}`).execute("resource-observer.publish", requestId, input, resourceObserverPublishOutputDto, async () => {
      const result = await new ResourceRepository(tx).publish(service.id, input, ttlDays);
      return resourceObserverPublishOutputDto.parse({ accepted: true, heartbeat_at: new Date(result.heartbeatAt).toISOString(), sampled_at: result.sampledAt === null ? null : new Date(result.sampledAt).toISOString() });
    });
  });
}
