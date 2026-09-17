// [Input] Existing typed Admin UOW and server-derived decimal canonical actor.
// [Output] Serialized owned oldest Workspace, explicit insert or current-owner receipt check.
// [Pos] Typed Drizzle repository; no own pool, commit, DDL or caller settings.
// [Sync] 2026-09-15: preserve created_at/id ordering and exact bigint actor parameters.
import { and, asc, eq, sql } from "drizzle-orm";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import { workspaceDefaultPolicy } from "../../../config/workspace-default-policy";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { operationRequestKeyDigest } from "./receipts";
export class WorkspaceDefaultRepository {
  private readonly actor: string;
  constructor(private readonly tx: DataTransaction, actor: string) { this.actor = decimalIdDto.parse(actor); }
  async lockActor() {
    const digest = operationRequestKeyDigest("workspace-default", this.actor, "workspace-default.ensure", "oldest-owned");
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`);
  }
  async oldestOwned() {
    return (await this.tx.select({ id: workspace.id }).from(workspace)
      .where(eq(workspace.owner_id, sql`${this.actor}::bigint`))
      .orderBy(asc(workspace.created_at), asc(workspace.id)).limit(1).for("share"))[0] ?? null;
  }
  async owned(id: string) {
    return (await this.tx.select({ id: workspace.id }).from(workspace)
      .where(and(eq(workspace.id, id), eq(workspace.owner_id, sql`${this.actor}::bigint`)))
      .limit(1).for("share"))[0] ?? null;
  }
  async insert(id: string) {
    await this.tx.insert(workspace).values({ id, name: workspaceDefaultPolicy.name,
      owner_id: sql`${this.actor}::bigint`, settings: {} });
  }
}
