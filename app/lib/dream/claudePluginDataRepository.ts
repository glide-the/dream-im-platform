// [Input] Caller-owned Admin transaction plus validated Claude Plugin domain identities.
// [Output] Typed Drizzle reads, locks and lifecycle writes for the shared plugin aggregate.
// [Pos] Registry175-182 persistence boundary; no filesystem, CLI or caller-selected query surface.
// [Sync] 2026-09-16: move Claude Plugin operation/catalog/installation persistence into Admin.
import { and, asc, count, desc, eq, or, sql } from "drizzle-orm";
import {
  claude_plugin_installations as installations,
  claude_plugin_marketplace_entries as marketplaceEntries,
  claude_plugin_marketplace_entry_policies as marketplacePolicies,
  claude_plugin_marketplace_revisions as marketplaceRevisions,
  claude_plugin_marketplaces as marketplaces,
  claude_plugin_operations as operations,
  deck_claude_plugin_refs as deckRefs,
} from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";

const operationFields = {
  id: operations.id,
  operation_kind: operations.operation_kind,
  requested_package_spec: operations.requested_package_spec,
  marketplace_entry_id: operations.marketplace_entry_id,
  status: operations.status,
  phase: operations.phase,
  progress: operations.progress,
  message: operations.message,
  executable: operations.executable,
  argv_json: operations.argv_json,
  cwd: operations.cwd,
  cli_version: operations.cli_version,
  exit_code: operations.exit_code,
  evidence_path: operations.evidence_path,
  installation_id: operations.installation_id,
  error_code: operations.error_code,
  error_summary: operations.error_summary,
  created_at: sql<string>`${operations.created_at}::text`,
  updated_at: sql<string>`${operations.updated_at}::text`,
  finished_at: sql<string | null>`${operations.finished_at}::text`,
};

const installationFields = {
  id: installations.id,
  requested_package_spec: installations.requested_package_spec,
  marketplace_entry_id: installations.marketplace_entry_id,
  package_name: installations.package_name,
  marketplace: installations.marketplace,
  requested_version: installations.requested_version,
  resolved_version: installations.resolved_version,
  source_type: installations.source_type,
  artifact_digest: installations.artifact_digest,
  artifact_path: installations.artifact_path,
  claude_cli_version: installations.claude_cli_version,
  cli_git_commit_sha: installations.cli_git_commit_sha,
  manifest_json: installations.manifest_json,
  component_inventory_json: installations.component_inventory_json,
  compatibility_json: installations.compatibility_json,
  status: installations.status,
  operation_id: installations.operation_id,
  error_code: installations.error_code,
  error_summary: installations.error_summary,
  file_count: installations.file_count,
  created_at: sql<string>`${installations.created_at}::text`,
  updated_at: sql<string>`${installations.updated_at}::text`,
  installed_at: sql<string | null>`${installations.installed_at}::text`,
};

export type ClaudePluginOperationInsert = typeof operations.$inferInsert;
export type ClaudePluginInstallationInsert = typeof installations.$inferInsert;

export class ClaudePluginDataRepository {
  constructor(private readonly tx: DataTransaction) {}

  async listInstallations() {
    return this.tx.select({
      ...installationFields,
      deck_ref_count: count(deckRefs.plugin_installation_id),
    }).from(installations).leftJoin(deckRefs, eq(deckRefs.plugin_installation_id, installations.id))
      .groupBy(...Object.values(installationFields))
      .orderBy(desc(installations.created_at), desc(installations.id));
  }

  async installation(id: string, lock: "share" | "update" = "share") {
    return (await this.tx.select(installationFields).from(installations)
      .where(eq(installations.id, id)).limit(1).for(lock))[0] ?? null;
  }

  async installationRefs(id: string) {
    return this.tx.select({ deck_id: deckRefs.deck_id, enabled: deckRefs.enabled, order_index: deckRefs.order_index })
      .from(deckRefs).where(eq(deckRefs.plugin_installation_id, id))
      .orderBy(asc(deckRefs.order_index), asc(deckRefs.deck_id)).for("share");
  }

  async findInstallationByArtifact(packageName: string, marketplace: string, resolvedVersion: string, artifactDigest: string) {
    return (await this.tx.select(installationFields).from(installations).where(and(
      eq(installations.package_name, packageName), eq(installations.marketplace, marketplace),
      eq(installations.resolved_version, resolvedVersion), eq(installations.artifact_digest, artifactDigest),
    )).limit(1).for("update"))[0] ?? null;
  }

  async insertInstallation(value: ClaudePluginInstallationInsert) {
    return (await this.tx.insert(installations).values(value).returning(installationFields))[0];
  }

  async reviveInstallation(id: string, value: ClaudePluginInstallationInsert) {
    return (await this.tx.update(installations).set({
      requested_package_spec: value.requested_package_spec,
      marketplace_entry_id: sql`COALESCE(${installations.marketplace_entry_id}, ${value.marketplace_entry_id ?? null})`,
      requested_version: value.requested_version,
      source_type: value.source_type,
      artifact_path: value.artifact_path,
      claude_cli_version: value.claude_cli_version,
      cli_git_commit_sha: value.cli_git_commit_sha,
      manifest_json: value.manifest_json,
      component_inventory_json: value.component_inventory_json,
      compatibility_json: value.compatibility_json,
      status: "ready",
      operation_id: value.operation_id,
      error_code: null,
      error_summary: null,
      file_count: value.file_count,
      updated_at: sql`CURRENT_TIMESTAMP`,
      installed_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(installations.id, id)).returning(installationFields))[0];
  }

  async attachInstallationLineage(id: string, marketplaceEntryId: string | null) {
    if (marketplaceEntryId === null) return;
    await this.tx.update(installations).set({
      marketplace_entry_id: sql`COALESCE(${installations.marketplace_entry_id}, ${marketplaceEntryId})`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(installations.id, id));
  }

  async uninstallInstallation(id: string) {
    return (await this.tx.update(installations).set({ status: "uninstalled", updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(installations.id, id)).returning(installationFields))[0] ?? null;
  }

  async disableInstallationRefs(id: string) {
    await this.tx.update(deckRefs).set({ enabled: 0, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(deckRefs.plugin_installation_id, id));
  }

  async listOperations(limit: number) {
    return this.tx.select(operationFields).from(operations)
      .orderBy(desc(operations.created_at), desc(operations.id)).limit(limit).for("share");
  }

  async operation(id: string, lock: "share" | "update" = "share") {
    return (await this.tx.select(operationFields).from(operations)
      .where(eq(operations.id, id)).limit(1).for(lock))[0] ?? null;
  }

  async insertOperation(value: ClaudePluginOperationInsert) {
    return (await this.tx.insert(operations).values(value).returning(operationFields))[0];
  }

  async updateOperation(id: string, value: Partial<ClaudePluginOperationInsert>) {
    return (await this.tx.update(operations).set({ ...value, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(operations.id, id)).returning(operationFields))[0] ?? null;
  }

  async marketplaceRows() {
    return this.tx.select({
      id: marketplaceEntries.id,
      package_name: marketplaceEntries.package_name,
      marketplace_name: marketplaceEntries.marketplace_name,
      package_spec: marketplaceEntries.package_spec,
      display_name: marketplaceEntries.display_name,
      description: marketplaceEntries.description,
      version: marketplaceEntries.version,
      homepage: marketplaceEntries.homepage,
      component_inventory_json: marketplaceEntries.component_inventory_json,
      compatibility_json: marketplaceEntries.compatibility_json,
      plugin_manifest_sha256: marketplaceEntries.plugin_manifest_sha256,
      plugin_digest: marketplaceEntries.plugin_digest,
      revision_id: marketplaceRevisions.id,
      resolved_commit_sha: marketplaceRevisions.resolved_commit_sha,
      requested_ref: marketplaceRevisions.requested_ref,
      marketplace_manifest_sha256: marketplaceRevisions.manifest_sha256,
      marketplace_id: marketplaces.id,
      marketplace_display_name: marketplaces.display_name,
      remote_url: marketplaces.remote_url,
    }).from(marketplacePolicies)
      .innerJoin(marketplaceEntries, and(
        eq(marketplaceEntries.id, marketplacePolicies.approved_entry_id),
        eq(marketplaceEntries.marketplace_id, marketplacePolicies.marketplace_id),
        eq(marketplaceEntries.package_name, marketplacePolicies.package_name),
      ))
      .innerJoin(marketplaceRevisions, eq(marketplaceRevisions.id, marketplaceEntries.revision_id))
      .innerJoin(marketplaces, eq(marketplaces.id, marketplaceEntries.marketplace_id))
      .where(and(eq(marketplacePolicies.decision, "approved"), eq(marketplaceEntries.validation_status, "valid"),
        eq(marketplaceRevisions.validation_status, "valid"), eq(marketplaces.status, "active")))
      .orderBy(asc(marketplaces.display_name), asc(marketplaceEntries.display_name), asc(marketplaceEntries.package_name))
      .for("share");
  }

  async readyInstallationsForMarketplace() {
    return this.tx.select({ id: installations.id, marketplace_entry_id: installations.marketplace_entry_id,
      package_name: installations.package_name, marketplace: installations.marketplace,
      resolved_version: installations.resolved_version, artifact_digest: installations.artifact_digest,
      status: installations.status, installed_at: installations.installed_at, created_at: installations.created_at })
      .from(installations).where(eq(installations.status, "ready"))
      .orderBy(desc(installations.installed_at), desc(installations.created_at), desc(installations.id)).for("share");
  }

  async marketplaceSource(entryId: string) {
    return (await this.tx.select({
      id: marketplaceEntries.id,
      package_spec: marketplaceEntries.package_spec,
      package_name: marketplaceEntries.package_name,
      marketplace_name: marketplaceEntries.marketplace_name,
      plugin_manifest_sha256: marketplaceEntries.plugin_manifest_sha256,
      plugin_digest: marketplaceEntries.plugin_digest,
      compatibility_json: marketplaceEntries.compatibility_json,
      resolved_commit_sha: marketplaceRevisions.resolved_commit_sha,
      requested_ref: marketplaceRevisions.requested_ref,
      marketplace_manifest_sha256: marketplaceRevisions.manifest_sha256,
      remote_url: marketplaces.remote_url,
    }).from(marketplacePolicies)
      .innerJoin(marketplaceEntries, and(
        eq(marketplaceEntries.id, marketplacePolicies.approved_entry_id),
        eq(marketplaceEntries.marketplace_id, marketplacePolicies.marketplace_id),
        eq(marketplaceEntries.package_name, marketplacePolicies.package_name),
      ))
      .innerJoin(marketplaceRevisions, eq(marketplaceRevisions.id, marketplaceEntries.revision_id))
      .innerJoin(marketplaces, eq(marketplaces.id, marketplaceEntries.marketplace_id))
      .where(and(eq(marketplaceEntries.id, entryId), eq(marketplacePolicies.decision, "approved"),
        eq(marketplaceEntries.validation_status, "valid"), eq(marketplaceRevisions.validation_status, "valid"),
        eq(marketplaces.status, "active"))).limit(1).for("share"))[0] ?? null;
  }

  async marketplaceEntryExists(entryId: string) {
    return (await this.tx.select({ id: marketplaceEntries.id }).from(marketplaceEntries)
      .where(eq(marketplaceEntries.id, entryId)).limit(1).for("share"))[0] ?? null;
  }
}

export type ClaudePluginOperationRow = NonNullable<Awaited<ReturnType<ClaudePluginDataRepository["operation"]>>>;
export type ClaudePluginInstallationRow = NonNullable<Awaited<ReturnType<ClaudePluginDataRepository["installation"]>>>;
