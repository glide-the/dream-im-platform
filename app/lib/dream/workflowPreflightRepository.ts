// [Input] Canonical owner and one Preflight identifier in the Admin data transaction.
// [Output] Original owner-scoped fields and exact stored expiry/consumption plus current database clock.
// [Pos] Fixed read-only Preflight ORM; no secret, stored token hash or SQL crosses the DTO boundary.
// [Sync] 2026-09-15: repeat current Deck ownership and retain raw timestamp precision.
import { and, eq, sql } from "drizzle-orm";
import { workflow_preflights as preflight, decks } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
export class WorkflowPreflightRepository {
  constructor(private readonly tx: DataTransaction) {}
  async read(canonicalUserId: string, preflightId: string) {
    decimalIdDto.parse(canonicalUserId);
    const rows = await this.tx.select({ workflow_preflight_id: preflight.workflow_preflight_id, deck_id: preflight.deck_id,
      binding_revision: preflight.binding_revision, deck_plugin_id: preflight.deck_plugin_id, deck_plugin_version: preflight.deck_plugin_version,
      runtime_plugin_lock_id: preflight.runtime_plugin_lock_id, deck_runtime_profile_id: preflight.deck_runtime_profile_id,
      deck_runtime_snapshot_id: preflight.deck_runtime_snapshot_id, deck_runtime_snapshot_summary_hash: preflight.deck_runtime_snapshot_summary_hash,
      input_hash: preflight.input_hash, status: preflight.status, error_code: preflight.error_code, failed_check: preflight.failed_check,
      expires_at: sql<string>`${preflight.expires_at}::text`, created_at: sql<string>`${preflight.created_at}::text`, created_by: preflight.created_by,
      consumed_at: sql<string | null>`${preflight.consumed_at}::text`, clock: sql<string>`clock_timestamp()::text`,
    }).from(preflight).innerJoin(decks, eq(decks.id, preflight.deck_id)).where(and(eq(preflight.workflow_preflight_id, preflightId),
      eq(preflight.created_by, canonicalUserId), eq(decks.owner_id, sql`${canonicalUserId}::bigint`))).limit(1);
    return rows[0] ?? null;
  }
}
