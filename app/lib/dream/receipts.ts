// [Input] Server-derived service/actor, named domain operation and original request/input.
// [Output] Atomic operation execution/receipt, conflict detection and original committed DTO.
// [Pos] Data UOW idempotency boundary; JSON/SQL/table/user identity is never caller-selected.
// [Sync] 2026-09-15: share original request/input digests with staged Preflight reservation.
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { operationReceipts } from "@ink-memory/db/schema/auth";
import { adminAuditLogs } from "@ink-memory/db/schema";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import { canonicalContractJson } from "./canonicalContractJson";
export function operationRequestKeyDigest(serviceClientId: string, actor: string, operation: string, requestId: string) {
  return createHash("sha256").update(canonicalContractJson([serviceClientId, actor, operation, requestId])).digest("hex");
}
export function operationInputDigest(input: unknown) {
  return createHash("sha256").update(canonicalContractJson(input)).digest("hex");
}
export class ReceiptRepository {
  constructor(private readonly tx: DataTransaction, private readonly serviceClientId: string, private readonly actor: string) {}
  private key(operation: string, requestId: string) {
    return and(eq(operationReceipts.serviceClientId, this.serviceClientId), eq(operationReceipts.actor, this.actor), eq(operationReceipts.operation, operation), eq(operationReceipts.requestId, requestId));
  }
  async find(operation: string, requestId: string) {
    const rows = await this.tx.select({ inputSha256: operationReceipts.inputSha256, result: operationReceipts.result }).from(operationReceipts).where(this.key(operation, requestId)).limit(1);
    if (!rows[0]) return null;
    const stored = z.strictObject({ schema_version: z.literal(1), data: z.json(), thread_scope: z.string().nullable(), editor_session_scope: z.string().nullable().optional(), run_scope: z.string().nullable().optional() }).parse(rows[0].result);
    return { inputSha256: rows[0].inputSha256, result: stored.data, threadScope: stored.thread_scope, editorSessionScope: stored.editor_session_scope ?? null, runScope: stored.run_scope ?? null };
  }
  async execute<T extends z.ZodType>(operation: string, requestId: string, input: unknown, output: T, action: () => Promise<z.output<T>>, threadScope: string | null = null, editorSessionScope: string | null = null, runScope: string | null = null): Promise<z.output<T>> {
    const keyDigest = operationRequestKeyDigest(this.serviceClientId, this.actor, operation, requestId);
    const inputHash = operationInputDigest(input);
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${keyDigest}, 0))`);
    const prior = await this.find(operation, requestId);
    if (prior) {
      if (prior.inputSha256 !== inputHash || prior.threadScope !== threadScope || prior.editorSessionScope !== editorSessionScope || prior.runScope !== runScope) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
      return output.parse(prior.result);
    }
    const result = output.parse(await action());
    await this.tx.insert(operationReceipts).values({ serviceClientId: this.serviceClientId, actor: this.actor, operation, requestId, inputSha256: inputHash, result: { schema_version: 1, data: result, thread_scope: threadScope, editor_session_scope: editorSessionScope, ...(runScope === null ? {} : { run_scope: runScope }) } });
    await this.tx.insert(adminAuditLogs).values({ id: `audit_${randomUUID().replaceAll("-", "")}`, actor_type: "service", actor_id: this.serviceClientId, action: `dream.${operation}`, resource_type: "dream_operation", resource_id: keyDigest, request_id: requestId, metadata: { input_sha256: inputHash } });
    return result;
  }
}
