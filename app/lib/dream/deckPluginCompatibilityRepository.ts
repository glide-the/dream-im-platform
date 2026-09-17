// [Input] Verified canonical owner and fixed Plugin/workspace metadata in the Admin transaction.
// [Output] Exact original release/lock/installation/materialization facts; no credential or artifact paths.
// [Pos] Reusable typed ORM for compatibility and Preflight; no FS/CLI or caller-selected SQL.
// [Sync] 2026-09-15: preserve distinct context/ready installation priorities and latest versus ANY materialization.
import { and, desc, eq, sql } from "drizzle-orm";
import { deck_plugin_releases as releases, deck_runtime_plugin_locks as locks, deck_plugin_installations as installations,
  runtime_plugin_materializations as materializations } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
const installationFields = { id: installations.id, scope_type: installations.scope_type, scope_id: installations.scope_id,
  status: installations.status, installed_versions_json: installations.installed_versions_json, approved_capabilities_json: installations.approved_capabilities_json };
export class DeckPluginCompatibilityRepository {
  constructor(private readonly tx: DataTransaction) {}
  async ownedWorkspace(canonicalUserId: string, workspaceId: string) {
    decimalIdDto.parse(canonicalUserId);
    return (await this.tx.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, workspaceId),
      eq(workspaces.owner_id, sql`${canonicalUserId}::bigint`))).limit(1).for("share"))[0] ?? null;
  }
  async release(pluginId: string, version: string) {
    return (await this.tx.select({ status: releases.status, manifest_json: releases.manifest_json, manifest_hash: releases.manifest_hash,
      workflow_definition_ref: releases.workflow_definition_ref }).from(releases).where(and(eq(releases.deck_plugin_id, pluginId), eq(releases.deck_plugin_version, version))).limit(1).for("share"))[0] ?? null;
  }
  async lock(pluginId: string, version: string) {
    return (await this.tx.select({ id: locks.id, deck_plugin_manifest_hash: locks.deck_plugin_manifest_hash, lock_json: locks.lock_json }).from(locks)
      .where(and(eq(locks.deck_plugin_id, pluginId), eq(locks.deck_plugin_version, version))).limit(1).for("share"))[0] ?? null;
  }
  async installation(pluginId: string, workspaceId: string, readyOnly: boolean) {
    const ready = readyOnly ? eq(installations.status, "ready") : undefined;
    const workspace = (await this.tx.select(installationFields).from(installations).where(and(eq(installations.deck_plugin_id, pluginId),
      eq(installations.scope_type, "workspace"), eq(installations.scope_id, workspaceId), ready)).limit(1).for("share"))[0];
    if (workspace) return workspace;
    const query = this.tx.select(installationFields).from(installations).where(and(eq(installations.deck_plugin_id, pluginId), eq(installations.scope_type, "instance"), ready));
    return (await (readyOnly ? query.orderBy(desc(installations.updated_at)) : query.orderBy(desc(installations.created_at), desc(installations.id))).limit(1).for("share"))[0] ?? null;
  }
  async materializations(pluginId: string, version: string, artifactDigest: string) {
    return this.tx.select({ claude_code_plugin_id: materializations.claude_code_plugin_id, artifact_digest: materializations.artifact_digest,
      materialized_digest: materializations.materialized_digest, verification_status: materializations.verification_status,
      declaration_status: materializations.declaration_status, materialization_status: materializations.materialization_status,
      activation_status: materializations.activation_status }).from(materializations).where(and(eq(materializations.claude_code_plugin_id, pluginId),
      eq(materializations.resolved_version, version), eq(materializations.artifact_digest, artifactDigest))).orderBy(desc(materializations.updated_at)).for("share");
  }
}
export type DeckPluginReleaseFacts = NonNullable<Awaited<ReturnType<DeckPluginCompatibilityRepository["release"]>>>;
export type DeckPluginInstallationFacts = NonNullable<Awaited<ReturnType<DeckPluginCompatibilityRepository["installation"]>>>;
export type DeckRuntimeLockFacts = NonNullable<Awaited<ReturnType<DeckPluginCompatibilityRepository["lock"]>>>;
