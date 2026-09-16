// [Input] Registered Claude Plugin operation, active OAuth principal and caller-owned Admin transaction.
// [Output] Global catalog projections and atomic operation/installation lifecycle transitions.
// [Pos] Registry175-182 domain authority; Dream retains CLI, Git and shared-filesystem execution.
// [Sync] 2026-09-16: preserve the production Claude Plugin state machine behind DTO-Service-Drizzle.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction, SchemaRequirement } from "./database";
import { pgTimestampToIso } from "./chatThreadDto";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { ClaudePluginDataRepository, type ClaudePluginInstallationInsert } from "./claudePluginDataRepository";
import * as dto from "./claudePluginDataDto";

export const claudePluginMarketplaceSchemaRequirement: SchemaRequirement = {
  capability: "dream.claude-plugin.remote-marketplace.v1",
  version: 1,
  contractSha256: "d215cb2764f656ab32e364a4900b3aac73fca60c77ef4c9f3a914fd192a8c314",
};
export const claudePluginDataSchemaRequirements = [dreamUnifiedSchemaRequirement, claudePluginMarketplaceSchemaRequirement] as const;

function fail(code: string, status = 409): never { throw new AuthBoundaryError(code, status); }

function timestamp(value: unknown, code = "CLAUDE_PLUGIN_DATA_INVALID") {
  const projected = pgTimestampToIso(String(value));
  if (!projected) fail(code, 503);
  return projected;
}

function nullableTimestamp(value: unknown) { return value === null || value === undefined ? null : timestamp(value); }

function jsonObject(value: unknown, code = "CLAUDE_PLUGIN_DATA_INVALID") {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") fail(code, 503);
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  fail(code, 503);
}

function validateStoredJson(value: string | null, nullable: boolean) {
  if (value === null && nullable) return;
  jsonObject(value);
}

function parsePackageSpec(raw: string) {
  const value = dto.claudePluginPackageSpecDto.parse(raw);
  const [package_name, marketplace, requested = null] = value.split("@");
  return { package_name, marketplace, requested_version: requested?.replace(/^v/, "") ?? null,
    canonical: `${package_name}@${marketplace}${requested ? `@${requested.replace(/^v/, "")}` : ""}` };
}

function operationView(row: Record<string, unknown>) {
  return dto.claudePluginOperationDto.parse({ ...row,
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
    finished_at: nullableTimestamp(row.finished_at),
  });
}

function installationView(row: Record<string, unknown>) {
  const { deck_ref_count: _deckRefCount, ...stored } = row;
  return dto.claudePluginInstallationDto.parse({ ...stored,
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
    installed_at: nullableTimestamp(row.installed_at),
  });
}

async function marketplaceSource(store: ClaudePluginDataRepository, entryId: string) {
  const row = await store.marketplaceSource(entryId);
  if (!row) {
    if (await store.marketplaceEntryExists(entryId)) fail("CLAUDE_PLUGIN_MARKETPLACE_ENTRY_UNAVAILABLE", 409);
    fail("CLAUDE_PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND", 404);
  }
  return dto.claudePluginMarketplaceSourceDto.parse({
    entry_id: row.id, package_spec: row.package_spec, package_name: row.package_name,
    marketplace_name: row.marketplace_name, remote_url: row.remote_url,
    requested_ref: row.requested_ref, approved_commit_sha: row.resolved_commit_sha,
    marketplace_manifest_sha256: row.marketplace_manifest_sha256,
    plugin_manifest_sha256: row.plugin_manifest_sha256,
    approved_plugin_digest: row.plugin_digest, compatibility: jsonObject(row.compatibility_json),
  });
}

async function listMarketplace(store: ClaudePluginDataRepository) {
  const installations = await store.readyInstallationsForMarketplace();
  const entries = [];
  for (const row of await store.marketplaceRows()) {
    const installed = installations.find(item => item.package_name === row.package_name
      && item.marketplace === row.marketplace_name
      && (item.marketplace_entry_id === row.id || item.artifact_digest === row.plugin_digest));
    entries.push(dto.claudePluginMarketplaceEntryDto.parse({
      id: row.id, package_name: row.package_name, marketplace_name: row.marketplace_name,
      package_spec: row.package_spec, display_name: row.display_name, description: row.description,
      version: row.version, homepage: row.homepage,
      component_inventory: jsonObject(row.component_inventory_json), compatibility: jsonObject(row.compatibility_json),
      revision: { id: row.revision_id, commit_sha: row.resolved_commit_sha,
        marketplace_manifest_sha256: row.marketplace_manifest_sha256,
        plugin_manifest_sha256: row.plugin_manifest_sha256, plugin_digest: row.plugin_digest,
        requested_ref: row.requested_ref },
      marketplace: { id: row.marketplace_id, display_name: row.marketplace_display_name, remote_url: row.remote_url },
      installation: installed ? { id: installed.id, status: "ready", resolved_version: installed.resolved_version } : null,
    }));
  }
  return dto.claudePluginMarketplaceListDto.parse({ entries, scope: "platform-global",
    permissions: { can_install_shared_plugins: true } });
}

async function prepareInstall(store: ClaudePluginDataRepository, input: dto.ClaudePluginInstallPrepareInput) {
  const source = input.source_kind === "marketplace_entry" ? await marketplaceSource(store, input.marketplace_entry_id) : null;
  const packageSpec = input.source_kind === "package" ? input.package_spec : source!.package_spec;
  const requestedSourceType = input.source_kind === "package" ? input.source_type ?? null : "marketplace";
  const parsed = parsePackageSpec(packageSpec);
  const operationId = `cop_${randomUUID().replaceAll("-", "")}`;
  await store.insertOperation({
    id: operationId, operation_kind: "install", requested_package_spec: parsed.canonical,
    marketplace_entry_id: source?.entry_id ?? null, status: "queued", phase: "queued", progress: 0,
    message: source ? "Queued for approved Marketplace install" : "Queued for real claude plugin install",
  });
  return dto.claudePluginInstallPlanDto.parse({
    accepted: true, operation_id: operationId, package_spec: parsed.canonical,
    marketplace_entry_id: source?.entry_id ?? null,
    requested_source_type: requestedSourceType,
    marketplace_source: source,
  });
}

async function reportInstall(store: ClaudePluginDataRepository, input: dto.ClaudePluginInstallReportInput) {
  const current = await store.operation(input.operation_id, "update");
  if (!current || current.operation_kind !== "install") fail("CLAUDE_PLUGIN_OPERATION_NOT_FOUND", 404);
  if (input.event === "begin") {
    if (current.status === "running") return operationView(current);
    if (current.status !== "queued") fail("CLAUDE_PLUGIN_OPERATION_CONFLICT", 409);
    return operationView((await store.updateOperation(current.id, { status: "running", phase: "starting", progress: 5,
      message: "Install execution started" }))!);
  }
  if (input.event === "progress") {
    if (current.status !== "running" || input.progress < current.progress) fail("CLAUDE_PLUGIN_OPERATION_CONFLICT", 409);
    return operationView((await store.updateOperation(current.id, { phase: input.phase, progress: input.progress,
      message: input.message }))!);
  }
  if (input.event === "fail") {
    if (current.status === "error" && current.error_code === input.error_code
      && current.error_summary === input.error_summary) return operationView(current);
    if (current.status === "ready") fail("CLAUDE_PLUGIN_OPERATION_CONFLICT", 409);
    return operationView((await store.updateOperation(current.id, { status: "error", phase: "error", progress: 100,
      message: input.error_summary, error_code: input.error_code, error_summary: input.error_summary,
      evidence_path: input.evidence_path, finished_at: new Date().toISOString() }))!);
  }
  if (current.status !== "running") fail("CLAUDE_PLUGIN_OPERATION_CONFLICT", 409);
  const expected = parsePackageSpec(current.requested_package_spec);
  const evidence = input.installation;
  if (evidence.package_name !== expected.package_name || evidence.marketplace !== expected.marketplace
    || evidence.requested_version !== expected.requested_version) fail("CLAUDE_PLUGIN_INSTALL_EVIDENCE_INVALID", 409);
  validateStoredJson(evidence.manifest_json, true);
  validateStoredJson(evidence.component_inventory_json, false);
  validateStoredJson(evidence.compatibility_json, false);
  const marketplaceEntryId = current.marketplace_entry_id;
  let compatibilityJson = evidence.compatibility_json;
  if (marketplaceEntryId !== null) {
    const source = await marketplaceSource(store, marketplaceEntryId);
    if (evidence.source_type !== "marketplace" || source.package_name !== evidence.package_name
      || source.marketplace_name !== evidence.marketplace || source.approved_plugin_digest !== evidence.artifact_digest) {
      fail("CLAUDE_PLUGIN_MARKETPLACE_REMOTE_DRIFT", 409);
    }
    compatibilityJson = JSON.stringify(source.compatibility);
  }
  const existing = await store.findInstallationByArtifact(evidence.package_name, evidence.marketplace,
    evidence.resolved_version, evidence.artifact_digest);
  const installationId = existing?.id ?? `cpi_${randomUUID().replaceAll("-", "")}`;
  const record: ClaudePluginInstallationInsert = {
    id: installationId, requested_package_spec: current.requested_package_spec,
    marketplace_entry_id: marketplaceEntryId, package_name: evidence.package_name,
    marketplace: evidence.marketplace, requested_version: evidence.requested_version,
    resolved_version: evidence.resolved_version, source_type: evidence.source_type,
    artifact_digest: evidence.artifact_digest, artifact_path: evidence.artifact_path,
    claude_cli_version: evidence.claude_cli_version, cli_git_commit_sha: evidence.cli_git_commit_sha,
    manifest_json: evidence.manifest_json, component_inventory_json: evidence.component_inventory_json,
    compatibility_json: compatibilityJson, status: "ready", operation_id: current.id,
    error_code: null, error_summary: null, file_count: evidence.file_count,
    installed_at: new Date().toISOString(),
  };
  let replayed = false;
  if (existing?.status === "ready") {
    await store.attachInstallationLineage(existing.id, marketplaceEntryId);
    replayed = true;
  } else if (existing) {
    await store.reviveInstallation(existing.id, record);
    replayed = true;
  } else await store.insertInstallation(record);
  const message = replayed
    ? `${expected.package_name}@${expected.marketplace} ${evidence.resolved_version} already installed; replayed existing record`
    : `Installed ${expected.package_name}@${expected.marketplace} ${evidence.resolved_version} (${evidence.artifact_digest.slice(0, 19)}…)`;
  return operationView((await store.updateOperation(current.id, {
    status: "ready", phase: "ready", progress: 100, message,
    executable: input.execution?.executable ?? null,
    argv_json: input.execution ? JSON.stringify(input.execution.argv) : null,
    cwd: input.execution?.cwd ?? null, cli_version: input.execution?.cli_version ?? null,
    exit_code: input.execution?.exit_code ?? null, evidence_path: input.evidence_path,
    installation_id: installationId, error_code: null, error_summary: null,
    finished_at: new Date().toISOString(),
  }))!);
}

async function uninstall(store: ClaudePluginDataRepository, installationId: string) {
  const current = await store.installation(installationId, "update");
  if (!current) fail("CLAUDE_PLUGIN_NOT_FOUND", 404);
  if (current.status !== "uninstalled") {
    await store.disableInstallationRefs(installationId);
    return installationView((await store.uninstallInstallation(installationId))!);
  }
  return installationView(current);
}

export async function runClaudePluginOperation(operation: dto.ClaudePluginOperation, rawInput: unknown,
  rawPrincipal: unknown, tx: DataTransaction) {
  const contract = dto.claudePluginOperationContracts[operation];
  if (!contract) fail("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) fail("INPUT_INVALID", 400);
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes(contract.userScope)) fail("DREAM_SCOPE_REQUIRED", 403);
  const store = new ClaudePluginDataRepository(tx);
  switch (operation) {
    case "claude-plugin.installations.list": {
      const rows = await store.listInstallations();
      return dto.claudePluginInstallationsListDto.parse({
        installations: rows.map(row => ({ ...installationView(row), deck_ref_count: Number(row.deck_ref_count) })),
        permissions: { can_manage_shared_plugins: true },
      });
    }
    case "claude-plugin.marketplace.list": return listMarketplace(store);
    case "claude-plugin.install.prepare": return prepareInstall(store, dto.claudePluginInstallPrepareInputDto.parse(parsed.data));
    case "claude-plugin.operations.list": {
      const input = dto.claudePluginOperationsListInputDto.parse(parsed.data);
      return dto.claudePluginOperationsListDto.parse({ operations: (await store.listOperations(input.limit)).map(operationView) });
    }
    case "claude-plugin.operation.read": {
      const input = dto.claudePluginOperationReadInputDto.parse(parsed.data);
      const row = await store.operation(input.operation_id);
      if (!row) fail("CLAUDE_PLUGIN_OPERATION_NOT_FOUND", 404);
      return operationView(row);
    }
    case "claude-plugin.installation.read": {
      const input = dto.claudePluginInstallationReadInputDto.parse(parsed.data);
      const row = await store.installation(input.installation_id);
      if (!row) fail("CLAUDE_PLUGIN_NOT_FOUND", 404);
      const refs = (await store.installationRefs(input.installation_id)).map(item => ({
        deck_id: item.deck_id, enabled: item.enabled !== 0, order_index: item.order_index,
      }));
      return dto.claudePluginInstallationDetailDto.parse({ ...installationView(row), deck_refs: refs });
    }
    case "claude-plugin.install.report": return reportInstall(store, dto.claudePluginInstallReportInputDto.parse(parsed.data));
    case "claude-plugin.installation.uninstall": {
      const input = dto.claudePluginInstallationUninstallInputDto.parse(parsed.data);
      return uninstall(store, input.installation_id);
    }
  }
}
