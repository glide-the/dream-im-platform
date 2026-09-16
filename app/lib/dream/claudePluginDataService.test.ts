// [Input] Strict Claude Plugin DTOs and mocked typed Repository state.
// [Output] Catalog, prepare, lifecycle, replay, drift, uninstall and closed-input verification.
// [Pos] Provider-free Registry175-182 domain tests; no database, filesystem or CLI process.
// [Sync] 2026-09-16: verify the Admin-owned shared Claude Plugin persistence aggregate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
import { ClaudePluginDataRepository } from "./claudePluginDataRepository";
import { runClaudePluginOperation } from "./claudePluginDataService";

const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" as const };
const tx = {} as DataTransaction;
const time = "2026-09-16 00:00:00.123456+00";
const digest = `sha256:${"d".repeat(64)}`;

function operation(patch: Record<string, unknown> = {}) {
  return { id: "cop_operation", operation_kind: "install", requested_package_spec: "demo@market",
    marketplace_entry_id: null, status: "queued", phase: "queued", progress: 0, message: "Queued",
    executable: null, argv_json: null, cwd: null, cli_version: null, exit_code: null,
    evidence_path: null, installation_id: null, error_code: null, error_summary: null,
    created_at: time, updated_at: time, finished_at: null, ...patch };
}

function installation(patch: Record<string, unknown> = {}) {
  return { id: "cpi_installation", requested_package_spec: "demo@market", marketplace_entry_id: null,
    package_name: "demo", marketplace: "market", requested_version: null, resolved_version: "1.0.0",
    source_type: "marketplace", artifact_digest: digest, artifact_path: "/shared/plugins/demo",
    claude_cli_version: "2.1.220", cli_git_commit_sha: null, manifest_json: '{"name":"demo"}',
    component_inventory_json: '{"skills":[]}', compatibility_json: "{}", status: "ready",
    operation_id: "cop_operation", error_code: null, error_summary: null, file_count: 3,
    created_at: time, updated_at: time, installed_at: time, ...patch };
}

function marketplaceSource() {
  return { id: "cpme_demo", package_spec: "demo@market", package_name: "demo", marketplace_name: "market",
    plugin_manifest_sha256: "c".repeat(64), plugin_digest: digest, compatibility_json: { claude_code: ">=2.1.0" },
    resolved_commit_sha: "a".repeat(40), requested_ref: null, marketplace_manifest_sha256: "b".repeat(64),
    remote_url: "https://github.com/example/market" };
}

beforeEach(() => {
  vi.spyOn(ClaudePluginDataRepository.prototype, "listInstallations").mockResolvedValue([{ ...installation(), deck_ref_count: 2 }] as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "installation").mockResolvedValue(installation() as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "installationRefs").mockResolvedValue([{ deck_id: "deck", enabled: 1, order_index: 0 }] as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "findInstallationByArtifact").mockResolvedValue(null);
  vi.spyOn(ClaudePluginDataRepository.prototype, "insertInstallation").mockImplementation(async value => installation(value as never) as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "reviveInstallation").mockImplementation(async (_id, value) => installation(value as never) as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "attachInstallationLineage").mockResolvedValue(undefined);
  vi.spyOn(ClaudePluginDataRepository.prototype, "uninstallInstallation").mockResolvedValue(installation({ status: "uninstalled" }) as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "disableInstallationRefs").mockResolvedValue(undefined);
  vi.spyOn(ClaudePluginDataRepository.prototype, "listOperations").mockResolvedValue([operation()] as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "operation").mockResolvedValue(operation() as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "insertOperation").mockImplementation(async value => operation(value as never) as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "updateOperation").mockImplementation(async (_id, value) => operation(value as never) as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "marketplaceRows").mockResolvedValue([{ ...marketplaceSource(),
    display_name: "Demo", description: null, version: "1.0.0", homepage: null, component_inventory_json: {},
    revision_id: "cpmr_revision", marketplace_id: "cpm_market", marketplace_display_name: "Market" }] as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "readyInstallationsForMarketplace").mockResolvedValue([]);
  vi.spyOn(ClaudePluginDataRepository.prototype, "marketplaceSource").mockResolvedValue(marketplaceSource() as never);
  vi.spyOn(ClaudePluginDataRepository.prototype, "marketplaceEntryExists").mockResolvedValue({ id: "cpme_demo" } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("Claude Plugin Admin data domain", () => {
  it("projects global installations, operation history and approved Marketplace entries", async () => {
    const listed = await runClaudePluginOperation("claude-plugin.installations.list", {}, principal, tx);
    expect(listed).toMatchObject({ permissions: { can_manage_shared_plugins: true },
      installations: [{ id: "cpi_installation", deck_ref_count: 2 }] });
    const operations = await runClaudePluginOperation("claude-plugin.operations.list", { limit: 20 }, principal, tx);
    expect(operations).toHaveProperty("operations.0.id", "cop_operation");
    const marketplace = await runClaudePluginOperation("claude-plugin.marketplace.list", {}, principal, tx);
    expect(marketplace).toMatchObject({ scope: "platform-global", entries: [{ id: "cpme_demo",
      revision: { plugin_digest: digest } }] });
  });

  it("prepares one immutable Marketplace operation without accepting caller lineage", async () => {
    const result = await runClaudePluginOperation("claude-plugin.install.prepare",
      { source_kind: "marketplace_entry", marketplace_entry_id: "cpme_demo" }, principal, tx);
    expect(result).toMatchObject({ accepted: true, package_spec: "demo@market",
      marketplace_entry_id: "cpme_demo", requested_source_type: "marketplace",
      marketplace_source: { approved_plugin_digest: digest } });
    expect(ClaudePluginDataRepository.prototype.insertOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation_kind: "install", requested_package_spec: "demo@market", marketplace_entry_id: "cpme_demo",
      status: "queued", phase: "queued", progress: 0 }));
  });

  it("moves queued through running/progress and atomically completes installation plus operation", async () => {
    let state = operation();
    vi.mocked(ClaudePluginDataRepository.prototype.operation).mockImplementation(async () => state as never);
    vi.mocked(ClaudePluginDataRepository.prototype.updateOperation).mockImplementation(async (_id, value) => {
      state = { ...state, ...value, updated_at: time };
      return state as never;
    });
    await runClaudePluginOperation("claude-plugin.install.report", { event: "begin", operation_id: state.id }, principal, tx);
    expect(state).toMatchObject({ status: "running", phase: "starting", progress: 5 });
    await runClaudePluginOperation("claude-plugin.install.report", { event: "progress", operation_id: state.id,
      phase: "verify", progress: 55, message: "Verifying manifest and computing artifact digest" }, principal, tx);
    const result = await runClaudePluginOperation("claude-plugin.install.report", { event: "complete", operation_id: state.id,
      installation: { package_name: "demo", marketplace: "market", requested_version: null,
        resolved_version: "1.0.0", source_type: "marketplace", artifact_digest: digest,
        artifact_path: "/shared/plugins/demo", claude_cli_version: "2.1.220", cli_git_commit_sha: null,
        manifest_json: '{"name":"demo"}', component_inventory_json: '{"skills":[]}',
        compatibility_json: "{}", file_count: 3 },
      execution: { executable: "/usr/local/bin/claude", argv: ["plugin", "install", "demo@market"],
        cwd: "/shared/install", cli_version: "2.1.220", exit_code: 0 }, evidence_path: "/shared/evidence/cop.json" }, principal, tx);
    expect(result).toMatchObject({ status: "ready", phase: "ready", progress: 100,
      installation_id: expect.stringMatching(/^cpi_/) });
    expect(ClaudePluginDataRepository.prototype.insertInstallation).toHaveBeenCalledTimes(1);
    expect(ClaudePluginDataRepository.prototype.updateOperation).toHaveBeenLastCalledWith("cop_operation",
      expect.objectContaining({ status: "ready", phase: "ready", installation_id: expect.stringMatching(/^cpi_/) }));
  });

  it("rejects Marketplace digest drift and malformed stored JSON before writes", async () => {
    vi.mocked(ClaudePluginDataRepository.prototype.operation).mockResolvedValue(operation({ status: "running", phase: "verify", progress: 55,
      marketplace_entry_id: "cpme_demo" }) as never);
    const base = { event: "complete" as const, operation_id: "cop_operation",
      installation: { package_name: "demo", marketplace: "market", requested_version: null,
        resolved_version: "1.0.0", source_type: "marketplace" as const,
        artifact_digest: `sha256:${"e".repeat(64)}`, artifact_path: "/shared/plugins/demo",
        claude_cli_version: "2.1.220", cli_git_commit_sha: null, manifest_json: '{"name":"demo"}',
        component_inventory_json: "{}", compatibility_json: "{}", file_count: 3 },
      execution: null, evidence_path: "/shared/evidence/cop.json" };
    await expect(runClaudePluginOperation("claude-plugin.install.report", base, principal, tx))
      .rejects.toMatchObject({ code: "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_DRIFT", status: 409 });
    await expect(runClaudePluginOperation("claude-plugin.install.report", { ...base,
      installation: { ...base.installation, artifact_digest: digest, component_inventory_json: "[]" } }, principal, tx))
      .rejects.toMatchObject({ code: "CLAUDE_PLUGIN_DATA_INVALID", status: 503 });
    expect(ClaudePluginDataRepository.prototype.insertInstallation).not.toHaveBeenCalled();
  });

  it("soft-uninstalls with Deck ref disable and rejects authority/query selectors", async () => {
    const result = await runClaudePluginOperation("claude-plugin.installation.uninstall",
      { installation_id: "cpi_installation" }, principal, tx);
    expect(result).toHaveProperty("status", "uninstalled");
    expect(ClaudePluginDataRepository.prototype.disableInstallationRefs).toHaveBeenCalledWith("cpi_installation");
    for (const key of ["actor_id", "user_id", "role", "sql", "table", "column", "transaction", "marketplace_entry_id"]) {
      await expect(runClaudePluginOperation("claude-plugin.installation.uninstall",
        { installation_id: "cpi_installation", [key]: "caller" }, principal, tx))
        .rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
    }
  });
});
