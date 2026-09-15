// [Input] Canonical actor and validated binding DTO inside one caller-owned Admin transaction.
// [Output] Owner-checked Deck/Workspace/Voice, current or frozen binding facts and Runtime metadata mutations.
// [Pos] Registry122-132 typed Drizzle Repository; no Runtime execution, filesystem or caller-selected SQL.
// [Sync] 2026-09-16: add launch current/replay facts without exposing storage paths.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import {
  claude_plugin_installations as claudeInstallations,
  decks,
  deck_plugin_bindings as bindings,
  deck_plugin_installations as deckInstallations,
  deck_plugin_releases as releases,
  deck_runtime_plugin_locks as locks,
  voices,
  workflow_preflights as preflights,
  workflow_runs as runs,
} from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";

const bindingFields = {
  deck_plugin_binding_id: bindings.deck_plugin_binding_id,
  deck_id: bindings.deck_id,
  workspace_id: bindings.workspace_id,
  creator_id: bindings.creator_id,
  deck_plugin_id: bindings.deck_plugin_id,
  deck_plugin_version: bindings.deck_plugin_version,
  binding_revision: bindings.binding_revision,
  status: bindings.status,
  applied_to: bindings.applied_to,
  created_at: bindings.created_at,
  updated_at: bindings.updated_at,
};

const runtimeTargetFields = {
  deck_plugin_id: releases.deck_plugin_id,
  deck_plugin_version: releases.deck_plugin_version,
  manifest_hash: releases.manifest_hash,
  capabilities_json: releases.capabilities_json,
  release_status: releases.status,
  runtime_plugin_lock_id: locks.id,
  deck_plugin_manifest_hash: locks.deck_plugin_manifest_hash,
  lock_json: locks.lock_json,
};

export class DeckPluginBindingRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  async ownsDeckWorkspace(deckId: string, workspaceId: string, lock: "share" | "update" = "share") {
    const query = this.tx.select({ id: decks.id }).from(decks).innerJoin(workspaces, and(
      eq(workspaces.id, workspaceId),
      eq(workspaces.owner_id, decks.owner_id),
    )).where(and(
      eq(decks.id, deckId),
      eq(decks.owner_id, sql`${this.actor}::bigint`),
      eq(workspaces.owner_id, sql`${this.actor}::bigint`),
    )).limit(1);
    return (await query.for(lock))[0] ?? null;
  }

  async ownsEnabledDeckWorkspace(deckId: string, workspaceId: string, lock: "share" | "update" = "share") {
    const query = this.tx.select({ id: decks.id }).from(decks).innerJoin(workspaces, and(
      eq(workspaces.id, workspaceId),
      eq(workspaces.owner_id, decks.owner_id),
    )).where(and(
      eq(decks.id, deckId),
      eq(decks.owner_id, sql`${this.actor}::bigint`),
      eq(workspaces.owner_id, sql`${this.actor}::bigint`),
      eq(decks.enabled, true),
    )).limit(1);
    return (await query.for(lock))[0] ?? null;
  }

  async enabledAgent(deckId: string, agentId: string) {
    return (await this.tx.select({ id: voices.id }).from(voices).where(and(
      eq(voices.id, agentId), eq(voices.deck_id, deckId), eq(voices.enabled, true),
    )).limit(1).for("share"))[0] ?? null;
  }

  async current(deckId: string, lock: "share" | "update" = "share") {
    return (await this.tx.select(bindingFields).from(bindings).where(and(
      eq(bindings.deck_id, deckId),
      eq(bindings.status, "active"),
    )).limit(1).for(lock))[0] ?? null;
  }

  async latestRevision(deckId: string) {
    const row = (await this.tx.select({ revision: max(bindings.binding_revision) }).from(bindings).where(eq(bindings.deck_id, deckId)))[0];
    return row?.revision ?? 0;
  }

  async history(deckId: string, limit: number) {
    return this.tx.select(bindingFields).from(bindings).where(eq(bindings.deck_id, deckId))
      .orderBy(desc(bindings.binding_revision)).limit(limit).for("share");
  }

  async selectableReleases() {
    return this.tx.select({
      display_name: releases.display_name,
      deck_plugin_id: releases.deck_plugin_id,
      deck_plugin_version: releases.deck_plugin_version,
      status: releases.status,
    }).from(releases).where(inArray(releases.status, ["published", "deprecated", "revoked"]))
      .orderBy(asc(releases.display_name), asc(releases.deck_plugin_id), desc(releases.deck_plugin_version)).for("share");
  }

  async runtimeTargets() {
    return this.tx.select(runtimeTargetFields).from(releases).innerJoin(locks, and(
      eq(locks.deck_plugin_id, releases.deck_plugin_id),
      eq(locks.deck_plugin_version, releases.deck_plugin_version),
    )).where(inArray(releases.status, ["published", "deprecated"]))
      .orderBy(asc(releases.deck_plugin_id), desc(releases.deck_plugin_version)).for("share");
  }

  async runtimeTargetByLock(lockId: string) {
    return (await this.tx.select(runtimeTargetFields).from(locks).innerJoin(releases, and(
      eq(releases.deck_plugin_id, locks.deck_plugin_id),
      eq(releases.deck_plugin_version, locks.deck_plugin_version),
    )).where(eq(locks.id, lockId)).limit(1).for("share"))[0] ?? null;
  }

  async replayBinding(workflowRunId: string, threadId: string, deckId: string, workspaceId: string, lock: "share" | "update") {
    const query = this.tx.select({
      workflow_run_id: runs.id,
      thread_id: runs.source_voice_thread_id,
      workspace_id: runs.workspace_id,
      deck_plugin_id: runs.deck_plugin_id,
      deck_plugin_version: runs.deck_plugin_version,
      deck_plugin_manifest_hash: runs.deck_plugin_manifest_hash,
      deck_plugin_binding_id: runs.deck_plugin_binding_id,
      binding_revision: runs.binding_revision,
      runtime_plugin_lock_id: runs.runtime_plugin_lock_id,
      preflight_deck_id: preflights.deck_id,
      binding_deck_id: bindings.deck_id,
      binding_workspace_id: bindings.workspace_id,
      binding_creator_id: bindings.creator_id,
      binding_plugin_id: bindings.deck_plugin_id,
      binding_plugin_version: bindings.deck_plugin_version,
      binding_revision_actual: bindings.binding_revision,
    }).from(runs).innerJoin(workspaces, eq(workspaces.id, runs.workspace_id))
      .innerJoin(preflights, eq(preflights.workflow_preflight_id, runs.workflow_preflight_id))
      .innerJoin(bindings, eq(bindings.deck_plugin_binding_id, runs.deck_plugin_binding_id))
      .where(and(
        eq(runs.id, workflowRunId), eq(runs.source_voice_thread_id, threadId),
        eq(runs.workspace_id, workspaceId), eq(runs.created_by, this.actor),
        eq(workspaces.owner_id, sql`${this.actor}::bigint`), eq(preflights.deck_id, deckId),
      )).limit(1);
    return (await query.for(lock))[0] ?? null;
  }

  async readyRuntimeInstallation(packageSpec: string, version: string, artifactDigest: string, sourceType: "platform-builtin") {
    return (await this.tx.select({
      plugin_installation_id: claudeInstallations.id,
      package_spec: claudeInstallations.requested_package_spec,
      package_name: claudeInstallations.package_name,
      marketplace: claudeInstallations.marketplace,
      resolved_version: claudeInstallations.resolved_version,
      artifact_digest: claudeInstallations.artifact_digest,
      artifact_path: claudeInstallations.artifact_path,
      compatibility_json: claudeInstallations.compatibility_json,
      manifest_json: claudeInstallations.manifest_json,
      source_type: claudeInstallations.source_type,
      status: claudeInstallations.status,
    }).from(claudeInstallations).where(and(
      eq(claudeInstallations.requested_package_spec, packageSpec),
      eq(claudeInstallations.resolved_version, version),
      eq(claudeInstallations.artifact_digest, artifactDigest),
      eq(claudeInstallations.source_type, sourceType),
      eq(claudeInstallations.status, "ready"),
    )).orderBy(desc(claudeInstallations.installed_at), desc(claudeInstallations.id)).limit(1).for("share"))[0] ?? null;
  }

  async workspaceInstallation(workspaceId: string, pluginId: string) {
    return (await this.tx.select().from(deckInstallations).where(and(
      eq(deckInstallations.scope_type, "workspace"),
      eq(deckInstallations.scope_id, workspaceId),
      eq(deckInstallations.deck_plugin_id, pluginId),
    )).limit(1).for("update"))[0] ?? null;
  }

  async insertReadyWorkspaceInstallation(workspaceId: string, pluginId: string, version: string, capabilities: string[],
    sourcePolicyId = "system:dream-agent-type/v1") {
    await this.tx.insert(deckInstallations).values({
      id: `dpi_${randomUUID().replaceAll("-", "")}`,
      scope_type: "workspace",
      scope_id: workspaceId,
      deck_plugin_id: pluginId,
      installed_versions_json: JSON.stringify([version]),
      default_version: version,
      status: "ready",
      approved_capabilities_json: JSON.stringify(capabilities),
      source_policy_id: sourcePolicyId,
      pending_version: null,
      pending_capabilities_json: null,
      revision: 1,
    }).onConflictDoNothing();
    return this.workspaceInstallation(workspaceId, pluginId);
  }

  async markCurrentStale(bindingId: string, revision: number) {
    return (await this.tx.update(bindings).set({ status: "stale", updated_at: sql`CURRENT_TIMESTAMP` }).where(and(
      eq(bindings.deck_plugin_binding_id, bindingId),
      eq(bindings.status, "active"),
      eq(bindings.binding_revision, revision),
    )).returning({ id: bindings.deck_plugin_binding_id })).length === 1;
  }

  async insert(input: { deck_id: string; workspace_id: string; deck_plugin_id: string; deck_plugin_version: string; binding_revision: number }) {
    return (await this.tx.insert(bindings).values({
      deck_plugin_binding_id: `dpb_${randomUUID().replaceAll("-", "")}`,
      deck_id: input.deck_id,
      workspace_id: input.workspace_id,
      creator_id: this.actor,
      deck_plugin_id: input.deck_plugin_id,
      deck_plugin_version: input.deck_plugin_version,
      binding_revision: input.binding_revision,
      status: "active",
      applied_to: "next_run",
    }).returning(bindingFields))[0];
  }

  async advanceDraftRevision(deckId: string) {
    await this.tx.update(decks).set({ draft_revision: sql`${decks.draft_revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(decks.id, deckId), eq(decks.owner_id, sql`${this.actor}::bigint`)));
  }
}

export type DeckPluginBindingRow = NonNullable<Awaited<ReturnType<DeckPluginBindingRepository["current"]>>>;
