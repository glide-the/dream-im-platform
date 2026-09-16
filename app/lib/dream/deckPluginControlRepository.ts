// [Input] Canonical actor, strict Deck Plugin control DTOs and a caller-owned Admin transaction.
// [Output] Owner-filtered release/lock/installation/materialization reads and revision-checked typed Drizzle writes.
// [Pos] Registry170-174 persistence boundary; no filesystem, generic CRUD or caller-selected SQL.
// [Sync] 2026-09-16: move the active Dream Deck Plugin control tables behind Admin ORM ownership.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { storyWorkspaceWorkspaces as workspaces, users } from "@ink-memory/db/schema";
import {
  deck_plugin_installations as installations,
  deck_plugin_releases as releases,
  deck_runtime_plugin_locks as locks,
  runtime_plugin_materializations as materializations,
} from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";

const installationFields = {
  id: installations.id,
  scope_type: installations.scope_type,
  scope_id: installations.scope_id,
  deck_plugin_id: installations.deck_plugin_id,
  installed_versions_json: installations.installed_versions_json,
  default_version: installations.default_version,
  status: installations.status,
  approved_capabilities_json: installations.approved_capabilities_json,
  source_policy_id: installations.source_policy_id,
  last_error_code: installations.last_error_code,
  last_error_summary: installations.last_error_summary,
  pending_version: installations.pending_version,
  pending_capabilities_json: installations.pending_capabilities_json,
  revision: installations.revision,
  created_at: sql<string>`${installations.created_at}::text`,
  updated_at: sql<string>`${installations.updated_at}::text`,
};

const releaseFields = {
  id: releases.id,
  deck_plugin_id: releases.deck_plugin_id,
  deck_plugin_version: releases.deck_plugin_version,
  display_name: releases.display_name,
  status: releases.status,
  manifest_json: releases.manifest_json,
  manifest_hash: releases.manifest_hash,
  updated_at: sql<string>`${releases.updated_at}::text`,
  runtime_plugin_lock_id: locks.id,
  deck_plugin_manifest_hash: locks.deck_plugin_manifest_hash,
  lock_json: locks.lock_json,
};

export type DeckPluginInstallationInsert = typeof installations.$inferInsert;
export type RuntimeMaterializationInsert = typeof materializations.$inferInsert;

export class DeckPluginControlRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  async actorRole() {
    return (await this.tx.select({ role: users.role }).from(users)
      .where(eq(users.id, sql`${this.actor}::bigint`)).limit(1).for("share"))[0] ?? null;
  }

  async ownedWorkspace(workspaceId: string, lock: "share" | "update" = "share") {
    return (await this.tx.select({ id: workspaces.id }).from(workspaces).where(and(
      eq(workspaces.id, workspaceId), eq(workspaces.owner_id, sql`${this.actor}::bigint`),
    )).limit(1).for(lock))[0] ?? null;
  }

  async serialize(scopeType: string, scopeId: string, pluginId: string) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`deck-plugin-control\0${scopeType}\0${scopeId}\0${pluginId}`}, 0))`);
  }

  async release(pluginId: string, version: string) {
    return (await this.tx.select(releaseFields).from(releases).innerJoin(locks, and(
      eq(locks.deck_plugin_id, releases.deck_plugin_id),
      eq(locks.deck_plugin_version, releases.deck_plugin_version),
    )).where(and(eq(releases.deck_plugin_id, pluginId), eq(releases.deck_plugin_version, version),
      inArray(releases.status, ["published", "deprecated"]))).limit(1).for("share"))[0] ?? null;
  }

  async availableVersions(pluginId: string) {
    return this.tx.select({ version: releases.deck_plugin_version }).from(releases).where(and(
      eq(releases.deck_plugin_id, pluginId), inArray(releases.status, ["published", "deprecated"]),
    )).for("share");
  }

  async installation(scopeType: string, scopeId: string, pluginId: string, lock: "share" | "update" = "share") {
    return (await this.tx.select(installationFields).from(installations).where(and(
      eq(installations.scope_type, scopeType), eq(installations.scope_id, scopeId),
      eq(installations.deck_plugin_id, pluginId),
    )).limit(1).for(lock))[0] ?? null;
  }

  async activeInstallations(scopeType: string, scopeId: string) {
    return this.tx.select(installationFields).from(installations).where(and(
      eq(installations.scope_type, scopeType), eq(installations.scope_id, scopeId), ne(installations.status, "uninstalled"),
    )).orderBy(desc(installations.updated_at), desc(installations.id)).for("share");
  }

  async latestMaterialization(pluginId: string, version: string, digest: string) {
    return (await this.tx.select({
      runtime_materialization_id: materializations.runtime_materialization_id,
      declaration_status: materializations.declaration_status,
      materialization_status: materializations.materialization_status,
      activation_status: materializations.activation_status,
      verification_status: materializations.verification_status,
      last_error: materializations.last_error,
      updated_at: sql<string>`${materializations.updated_at}::text`,
    }).from(materializations).where(and(eq(materializations.claude_code_plugin_id, pluginId),
      eq(materializations.resolved_version, version), eq(materializations.artifact_digest, digest)))
      .orderBy(desc(materializations.updated_at), desc(materializations.runtime_materialization_id)).limit(1).for("share"))[0] ?? null;
  }

  async materializationByKey(key: string) {
    return (await this.tx.select({ id: materializations.runtime_materialization_id }).from(materializations)
      .where(eq(materializations.materialization_key, key)).limit(1).for("update"))[0] ?? null;
  }

  async insertInstallation(value: DeckPluginInstallationInsert) {
    return (await this.tx.insert(installations).values(value).returning(installationFields))[0];
  }

  async updateInstallation(id: string, expectedRevision: number, values: Partial<DeckPluginInstallationInsert>) {
    return (await this.tx.update(installations).set({ ...values, revision: expectedRevision + 1,
      updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(installations.id, id), eq(installations.revision, expectedRevision)))
      .returning(installationFields))[0] ?? null;
  }

  async deleteInstallation(id: string, expectedRevision: number) {
    return (await this.tx.delete(installations).where(and(eq(installations.id, id),
      eq(installations.revision, expectedRevision))).returning({ id: installations.id })).length === 1;
  }

  async insertMaterialization(value: RuntimeMaterializationInsert) {
    await this.tx.insert(materializations).values(value);
  }

  async refreshMaterialization(id: string, digest: string, cacheRef: string, now: string) {
    await this.tx.update(materializations).set({ materialized_digest: digest,
      declaration_status: "declared", materialization_status: "materialized", activation_status: "loadable",
      verification_status: "verified", cache_ref: cacheRef, last_error: null,
      attempt_id: `rpa_${randomUUID().replaceAll("-", "")}`,
      attempt_count: sql`${materializations.attempt_count} + 1`, updated_at: now })
      .where(eq(materializations.runtime_materialization_id, id));
  }

  async clock() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS value`);
    return String(result.rows[0]?.value ?? "");
  }
}

export type DeckPluginControlInstallationRow = NonNullable<Awaited<ReturnType<DeckPluginControlRepository["installation"]>>>;
export type DeckPluginControlReleaseRow = NonNullable<Awaited<ReturnType<DeckPluginControlRepository["release"]>>>;
