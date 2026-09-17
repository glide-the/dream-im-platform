// [Input] Verified canonical/workspace owner and fixed Preflight dependency facts in caller-owned Admin UOW.
// [Output] Original identity/binding/snapshot/materialization receipts with raw canonical storage.
// [Pos] Typed owner-scoped metadata repository; Runtime/FS/CLI stay in Dream and no commit occurs here.
// [Sync] 2026-09-15: preserve snapshot content/hash, Deck-before-Voice locks and latest-row load-smoke semantics.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { decks, voices, deck_plugin_bindings as bindings, deck_plugin_releases as releases, deck_runtime_plugin_locks as locks,
  deck_runtime_snapshots as snapshots } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { parseDeckPluginManifest } from "./deckPluginManifestDto";
import { parseDeckRuntimePluginLock } from "./deckRuntimePluginLockDto";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import { preflightBindingReleaseDto, preflightMaterializationDto, preflightSnapshotReceiptDto, WorkflowPreflightCheckError } from "./workflowPreflightDependencies";
export class WorkflowPreflightDependencyRepository {
  constructor(private readonly tx: DataTransaction, private readonly canonicalUserId: string, private readonly workspaceId: string) { decimalIdDto.parse(canonicalUserId); }
  private owner(column: typeof decks.owner_id | typeof workspaces.owner_id) { return eq(column, sql`${this.canonicalUserId}::bigint`); }
  async identity(deckId: string) {
    const row = (await this.tx.select({ id: decks.id }).from(decks).innerJoin(workspaces, and(eq(workspaces.id, this.workspaceId), eq(workspaces.owner_id, decks.owner_id)))
      .where(and(eq(decks.id, deckId), this.owner(decks.owner_id), eq(decks.enabled, true))).limit(1).for("share", { of: [decks, workspaces] }))[0];
    if (!row) throw new WorkflowPreflightCheckError("WORKFLOW_PERMISSION_DENIED");
    return { workspace_id: this.workspaceId };
  }
  async binding(deckId: string, revision: number) {
    const row = (await this.tx.select({ manifest_json: releases.manifest_json, manifest_hash: releases.manifest_hash,
      lock_json: locks.lock_json, lock_manifest_hash: locks.deck_plugin_manifest_hash }).from(bindings)
      .innerJoin(releases, and(eq(releases.deck_plugin_id, bindings.deck_plugin_id), eq(releases.deck_plugin_version, bindings.deck_plugin_version)))
      .innerJoin(locks, and(eq(locks.deck_plugin_id, bindings.deck_plugin_id), eq(locks.deck_plugin_version, bindings.deck_plugin_version)))
      .innerJoin(decks, eq(decks.id, bindings.deck_id)).innerJoin(workspaces, eq(workspaces.id, bindings.workspace_id))
      .where(and(eq(bindings.deck_id, deckId), eq(bindings.binding_revision, revision), eq(bindings.status, "active"), eq(bindings.workspace_id, this.workspaceId),
        eq(bindings.creator_id, this.canonicalUserId), this.owner(decks.owner_id), this.owner(workspaces.owner_id))).limit(1).for("share", { of: [bindings, releases, locks, decks, workspaces] }))[0];
    if (!row || row.manifest_hash !== row.lock_manifest_hash) throw new WorkflowPreflightCheckError("BINDING_REVISION_CONFLICT");
    const manifest = parseDeckPluginManifest(row.manifest_json), lock = parseDeckRuntimePluginLock(row.lock_json);
    if (!manifest.success || !lock.success) throw new Error("Invalid stored binding metadata.");
    return preflightBindingReleaseDto.parse({ deck_plugin_id: manifest.data.deck_plugin_id, deck_plugin_version: manifest.data.deck_plugin_version,
      runtime_plugin_lock_id: lock.data.runtime_plugin_lock_id, deck_runtime_profile_id: `drp_${createHash("sha256").update(manifest.data.runtime_configuration.profile_contract, "utf8").digest("hex").slice(0, 32)}`,
      deck_runtime_snapshot_contract: manifest.data.compatibility.deck_runtime_snapshot_contract, manifest_hash: row.manifest_hash,
      workflow_definition_ref: manifest.data.workflow.workflow_definition_ref, input_schema_ref: manifest.data.workflow.input_schema_ref || "schema://none",
      output_schema_ref: manifest.data.workflow.output_schema_ref || "schema://none", required_runtime_plugins: lock.data.claude_code_plugins.filter(entry => entry.required).map(entry => ({ claude_code_plugin_id: entry.claude_code_plugin_id, artifact_digest: entry.artifact_digest })) });
  }
  async snapshot(deckId: string, profileId: string, contract: string) {
    const deck = (await this.tx.select({ id: decks.id, name: decks.name, name_zh: decks.name_zh, name_en: decks.name_en,
      description: decks.description, description_zh: decks.description_zh, description_en: decks.description_en }).from(decks).where(and(eq(decks.id, deckId), this.owner(decks.owner_id))).limit(1).for("update"))[0];
    const binding = (await this.tx.select({ deck_plugin_binding_id: bindings.deck_plugin_binding_id, binding_revision: bindings.binding_revision,
      deck_plugin_id: bindings.deck_plugin_id, deck_plugin_version: bindings.deck_plugin_version }).from(bindings)
      .where(and(eq(bindings.deck_id, deckId), eq(bindings.workspace_id, this.workspaceId), eq(bindings.creator_id, this.canonicalUserId), eq(bindings.status, "active"))).limit(1).for("share"))[0];
    if (!deck || !binding) throw new WorkflowPreflightCheckError("DECK_RUNTIME_CONFIG_INVALID");
    const voiceRows = await this.tx.select({ id: voices.id, name: voices.name, name_zh: voices.name_zh, name_en: voices.name_en, system_prompt: voices.system_prompt })
      .from(voices).where(and(eq(voices.deck_id, deckId), eq(voices.enabled, true))).orderBy(asc(voices.order_index), asc(voices.id)).for("share");
    const config = await canonicalBusinessJson(JSON.stringify({ deck, voices: voiceRows, binding, profile_id: profileId, snapshot_contract: contract }));
    const existing = (await this.tx.select({ deck_runtime_snapshot_id: snapshots.deck_runtime_snapshot_id, sanitized_summary_hash: snapshots.sanitized_summary_hash }).from(snapshots)
      .where(and(eq(snapshots.deck_id, deckId), eq(snapshots.binding_revision, binding.binding_revision), eq(snapshots.deck_runtime_profile_id, profileId), eq(snapshots.config_hash, config.content_hash))).limit(1))[0];
    if (existing) return preflightSnapshotReceiptDto.parse({ ...existing, reused: true });
    const summary = await canonicalBusinessJson(JSON.stringify({ deck_id: deckId, binding_revision: binding.binding_revision, profile_id: profileId, voice_count: voiceRows.length, config_hash: config.content_hash }));
    const snapshotId = `drs_${randomUUID().replaceAll("-", "")}`;
    await this.tx.insert(snapshots).values({ deck_runtime_snapshot_id: snapshotId, deck_id: deckId, deck_plugin_binding_id: binding.deck_plugin_binding_id, binding_revision: binding.binding_revision,
      deck_runtime_profile_id: profileId, snapshot_contract: contract, config_hash: config.content_hash, config_json: config.canonical_json, sanitized_summary_hash: summary.content_hash });
    return preflightSnapshotReceiptDto.parse({ deck_runtime_snapshot_id: snapshotId, sanitized_summary_hash: summary.content_hash, reused: false });
  }
  async materialization(lockId: string) {
    const row = (await this.tx.select({ lock_json: locks.lock_json }).from(locks).where(eq(locks.id, lockId)).limit(1).for("share"))[0];
    if (!row) throw new WorkflowPreflightCheckError("RUNTIME_PLUGIN_NOT_READY");
    const lock = parseDeckRuntimePluginLock(row.lock_json);
    if (!lock.success) throw new Error("Invalid stored lock metadata.");
    const store = new DeckPluginCompatibilityRepository(this.tx), plugins: Array<{ claude_code_plugin_id: string; declaration_status: string; materialization_status: string; activation_status: string; artifact_digest: string }> = [];
    let smoke = true;
    for (const entry of lock.data.claude_code_plugins) {
      const latest = (await store.materializations(entry.claude_code_plugin_id, entry.resolved_version, entry.artifact_digest))[0];
      if (!latest) { plugins.push({ claude_code_plugin_id: entry.claude_code_plugin_id, declaration_status: "undeclared", materialization_status: "missing", activation_status: "inactive", artifact_digest: entry.artifact_digest }); smoke = false; continue; }
      plugins.push({ claude_code_plugin_id: entry.claude_code_plugin_id, declaration_status: latest.declaration_status, materialization_status: latest.materialization_status, activation_status: latest.activation_status, artifact_digest: latest.artifact_digest });
      smoke = smoke && latest.materialized_digest === entry.artifact_digest && ["verified", "legacy_unverified"].includes(latest.verification_status ?? "") && latest.materialization_status === "materialized" && ["loadable", "loaded"].includes(latest.activation_status);
    }
    return preflightMaterializationDto.parse({ runtime_plugin_lock_id: lockId, plugins, load_smoke_passed: smoke });
  }
}
