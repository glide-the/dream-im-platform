// [Input] Typed data UOW, strict desired setting identity and content-free diagnostics DTO.
// [Output] ORM policy reads and DB-clock latest snapshot upsert/TTL cleanup in one transaction.
// [Pos] Resource persistence repository; no runtime policy/admission/process ownership.
// [Sync] 2026-09-14: preserve DB-clock freshness and serialize writes per service/instance.
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { systemSettings } from "@ink-memory/db/schema";
import { claude_agent_resource_snapshots as snapshots } from "@ink-memory/db/schema/dream";
import { claudeAgentResourcePolicy as policy } from "../../../config/claude-agent-resource-policy";
import type { DataTransaction } from "./database";
import type { z } from "zod";
import type { resourceObserverPublishInputDto } from "./resourceDto";
export class ResourceRepository {
  constructor(private readonly tx: DataTransaction) {}
  async readPolicy() {
    const rows = await this.tx.select({ value: systemSettings.value, updatedAt: systemSettings.updated_at }).from(systemSettings).where(and(eq(systemSettings.category, policy.setting.category), eq(systemSettings.key, policy.setting.key))).limit(1);
    return rows[0] ?? null;
  }
  async publish(serviceClientId: string, input: z.infer<typeof resourceObserverPublishInputDto>, ttlDays: number) {
    const instanceId = `${createHash("sha256").update(serviceClientId).digest("hex")}:${input.instance_id}`;
    const clock = sql<string>`CURRENT_TIMESTAMP`;
    const sampled = input.sampled_at === null ? null : clock;
    const rows = await this.tx.insert(snapshots).values({
      instance_id: instanceId, process_started_at: sql`LEAST(${input.process_started_at}::timestamptz, CURRENT_TIMESTAMP)`, heartbeat_at: clock, sampled_at: sampled, snapshot: input.snapshot,
    }).onConflictDoUpdate({ target: snapshots.instance_id, set: { heartbeat_at: clock, sampled_at: sampled, snapshot: input.snapshot, updated_at: clock } })
      .returning({ heartbeatAt: snapshots.heartbeat_at, sampledAt: snapshots.sampled_at });
    await this.tx.delete(snapshots).where(and(ne(snapshots.instance_id, instanceId), lt(snapshots.heartbeat_at, sql`CURRENT_TIMESTAMP - make_interval(days => ${ttlDays})`)));
    return rows[0];
  }
}
