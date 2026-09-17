// [Input] Closed shared Claude Plugin catalog selectors, install commands and Dream-produced local execution evidence.
// [Output] Strict global catalog, operation, installation, lifecycle and builtin-reconciliation DTO contracts.
// [Pos] Registry175-184 wire contract; callers cannot select actors, Decks, SQL, tables, columns or transactions.
// [Sync] 2026-09-16: append service-only builtin ensure/report without changing Registry175-182 contracts.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";

const text = z.string().trim().min(1);
const identifier = text.max(255);
const boundedPath = text.max(4096);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const commitSha = z.string().regex(/^[0-9a-f]{40}$/);
const packageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const version = z.string().trim().min(1).max(255);
export const claudePluginPackageSpecDto = z.string().trim().min(3).max(300).refine(value => {
  const parts = value.split("@");
  if (parts.length !== 2 && parts.length !== 3) return false;
  if (!parts.every((part, index) => index === 2
    ? /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(part)
    : /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part))) return false;
  return ![".", ".."].includes(parts[0]) && ![".", ".."].includes(parts[1]);
}, "Invalid Claude Plugin package spec.");

const sourceType = z.enum(["claude-official", "marketplace", "github", "platform-builtin"]);
const operationStatus = z.enum(["queued", "running", "ready", "error"]);
const operationPhase = z.enum(["queued", "starting", "cli-install", "cli-validate", "verify", "import", "ready", "error"]);

export const claudePluginEmptyInputDto = z.strictObject({});
export const claudePluginOperationsListInputDto = z.strictObject({ limit: z.number().int().min(1).max(100) });
export const claudePluginOperationReadInputDto = z.strictObject({ operation_id: identifier });
export const claudePluginInstallationReadInputDto = z.strictObject({ installation_id: identifier });
export const claudePluginInstallationUninstallInputDto = claudePluginInstallationReadInputDto;

export const claudePluginOperationDto = z.strictObject({
  id: identifier,
  operation_kind: z.enum(["install", "uninstall", "validate", "revalidate"]),
  requested_package_spec: claudePluginPackageSpecDto,
  marketplace_entry_id: identifier.nullable(),
  status: operationStatus,
  phase: operationPhase,
  progress: z.number().int().min(0).max(100),
  message: z.string().nullable(),
  executable: z.string().nullable(),
  argv_json: z.string().nullable(),
  cwd: z.string().nullable(),
  cli_version: z.string().nullable(),
  exit_code: z.number().int().nullable(),
  evidence_path: z.string().nullable(),
  installation_id: identifier.nullable(),
  error_code: identifier.nullable(),
  error_summary: z.string().nullable(),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  finished_at: isoTimeDto.nullable(),
});

export const claudePluginInstallationDto = z.strictObject({
  id: identifier,
  requested_package_spec: claudePluginPackageSpecDto,
  marketplace_entry_id: identifier.nullable(),
  package_name: packageName,
  marketplace: packageName,
  requested_version: version.nullable(),
  resolved_version: version,
  source_type: sourceType,
  artifact_digest: digest,
  artifact_path: boundedPath,
  claude_cli_version: text.max(255),
  cli_git_commit_sha: z.string().max(255).nullable(),
  manifest_json: z.string().nullable(),
  component_inventory_json: z.string(),
  compatibility_json: z.string(),
  status: z.enum(["installing", "ready", "error", "uninstalled"]),
  operation_id: identifier,
  error_code: identifier.nullable(),
  error_summary: z.string().nullable(),
  file_count: z.number().int().nonnegative(),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  installed_at: isoTimeDto.nullable(),
});

export const claudePluginInstallationListItemDto = claudePluginInstallationDto.extend({
  deck_ref_count: z.number().int().nonnegative(),
});
export const claudePluginDeckRefDto = z.strictObject({
  deck_id: identifier,
  enabled: z.boolean(),
  order_index: z.number().int(),
});
export const claudePluginInstallationDetailDto = claudePluginInstallationDto.extend({
  deck_refs: z.array(claudePluginDeckRefDto),
});
export const claudePluginInstallationsListDto = z.strictObject({
  installations: z.array(claudePluginInstallationListItemDto),
  permissions: z.strictObject({ can_manage_shared_plugins: z.literal(true) }),
});
export const claudePluginOperationsListDto = z.strictObject({ operations: z.array(claudePluginOperationDto) });

const jsonObject = z.record(z.string(), z.unknown());
export const claudePluginMarketplaceSourceDto = z.strictObject({
  entry_id: identifier,
  package_spec: claudePluginPackageSpecDto,
  package_name: packageName,
  marketplace_name: packageName,
  remote_url: text.max(2048),
  requested_ref: z.string().max(255).nullable(),
  approved_commit_sha: commitSha,
  marketplace_manifest_sha256: sha256,
  plugin_manifest_sha256: sha256.nullable(),
  approved_plugin_digest: digest,
  compatibility: jsonObject,
});
export const claudePluginMarketplaceEntryDto = z.strictObject({
  id: identifier,
  package_name: packageName,
  marketplace_name: packageName,
  package_spec: claudePluginPackageSpecDto,
  display_name: text.max(500),
  description: z.string().nullable(),
  version: z.string().nullable(),
  homepage: z.string().nullable(),
  component_inventory: jsonObject,
  compatibility: jsonObject,
  revision: z.strictObject({
    id: identifier,
    commit_sha: commitSha,
    marketplace_manifest_sha256: sha256,
    plugin_manifest_sha256: sha256.nullable(),
    plugin_digest: digest,
    requested_ref: z.string().max(255).nullable(),
  }),
  marketplace: z.strictObject({ id: identifier, display_name: text.max(500), remote_url: text.max(2048) }),
  installation: z.strictObject({ id: identifier, status: z.literal("ready"), resolved_version: version }).nullable(),
});
export const claudePluginMarketplaceListDto = z.strictObject({
  entries: z.array(claudePluginMarketplaceEntryDto),
  scope: z.literal("platform-global"),
  permissions: z.strictObject({ can_install_shared_plugins: z.literal(true) }),
});

const preparePackage = z.strictObject({
  source_kind: z.literal("package"),
  package_spec: claudePluginPackageSpecDto,
  source_type: z.enum(["claude-official", "marketplace", "platform-builtin"]).nullable(),
});
const prepareMarketplace = z.strictObject({
  source_kind: z.literal("marketplace_entry"),
  marketplace_entry_id: identifier,
});
export const claudePluginInstallPrepareInputDto = z.discriminatedUnion("source_kind", [preparePackage, prepareMarketplace]);
export const claudePluginInstallPlanDto = z.strictObject({
  accepted: z.literal(true),
  operation_id: identifier,
  package_spec: claudePluginPackageSpecDto,
  marketplace_entry_id: identifier.nullable(),
  requested_source_type: z.enum(["claude-official", "marketplace", "platform-builtin"]).nullable(),
  marketplace_source: claudePluginMarketplaceSourceDto.nullable(),
});

const beginReport = z.strictObject({ event: z.literal("begin"), operation_id: identifier });
const progressReport = z.discriminatedUnion("phase", [
  z.strictObject({ event: z.literal("progress"), operation_id: identifier, phase: z.literal("cli-install"), progress: z.literal(20), message: text.max(1000) }),
  z.strictObject({ event: z.literal("progress"), operation_id: identifier, phase: z.literal("cli-validate"), progress: z.literal(20), message: text.max(1000) }),
  z.strictObject({ event: z.literal("progress"), operation_id: identifier, phase: z.literal("verify"), progress: z.literal(55), message: text.max(1000) }),
  z.strictObject({ event: z.literal("progress"), operation_id: identifier, phase: z.literal("import"), progress: z.literal(80), message: text.max(1000) }),
]);
const failReport = z.strictObject({
  event: z.literal("fail"), operation_id: identifier, error_code: identifier,
  error_summary: text.max(2000), evidence_path: boundedPath,
});
export const claudePluginInstallationEvidenceDto = z.strictObject({
  package_name: packageName,
  marketplace: packageName,
  requested_version: version.nullable(),
  resolved_version: version,
  source_type: z.enum(["claude-official", "marketplace", "platform-builtin"]),
  artifact_digest: digest,
  artifact_path: boundedPath,
  claude_cli_version: text.max(255),
  cli_git_commit_sha: z.string().max(255).nullable(),
  manifest_json: z.string().max(1_000_000).nullable(),
  component_inventory_json: z.string().max(1_000_000),
  compatibility_json: z.string().max(1_000_000),
  file_count: z.number().int().nonnegative().safe(),
});
export const claudePluginExecutionEvidenceDto = z.strictObject({
  executable: text.max(4096), argv: z.array(z.string().max(4096)).max(128), cwd: boundedPath,
  cli_version: text.max(255), exit_code: z.number().int(),
}).nullable();
const completeReport = z.strictObject({
  event: z.literal("complete"), operation_id: identifier,
  installation: claudePluginInstallationEvidenceDto,
  execution: claudePluginExecutionEvidenceDto,
  evidence_path: boundedPath,
});
export const claudePluginInstallReportInputDto = z.discriminatedUnion("event", [beginReport, progressReport, failReport, completeReport]);

export const claudePluginBuiltinEnsureInputDto = z.strictObject({ package_spec: claudePluginPackageSpecDto });
export const claudePluginBuiltinEnsureOutputDto = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("ready"), package_spec: claudePluginPackageSpecDto,
    installation_id: identifier, refs_created: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("install"), plan: claudePluginInstallPlanDto }),
]);
export const claudePluginBuiltinReportOutputDto = z.strictObject({
  operation: claudePluginOperationDto,
  refs_created: z.number().int().nonnegative(),
});

export const claudePluginOperationContracts = {
  "claude-plugin.installations.list": { audience: "user" as const, kind: "read" as const, userScope: "dream:read", backgroundScope: null, input: claudePluginEmptyInputDto, output: claudePluginInstallationsListDto },
  "claude-plugin.marketplace.list": { audience: "user" as const, kind: "read" as const, userScope: "dream:read", backgroundScope: null, input: claudePluginEmptyInputDto, output: claudePluginMarketplaceListDto },
  "claude-plugin.install.prepare": { audience: "user" as const, kind: "write" as const, userScope: "dream:write", backgroundScope: null, input: claudePluginInstallPrepareInputDto, output: claudePluginInstallPlanDto },
  "claude-plugin.operations.list": { audience: "user" as const, kind: "read" as const, userScope: "dream:read", backgroundScope: null, input: claudePluginOperationsListInputDto, output: claudePluginOperationsListDto },
  "claude-plugin.operation.read": { audience: "user" as const, kind: "read" as const, userScope: "dream:read", backgroundScope: null, input: claudePluginOperationReadInputDto, output: claudePluginOperationDto },
  "claude-plugin.installation.read": { audience: "user" as const, kind: "read" as const, userScope: "dream:read", backgroundScope: null, input: claudePluginInstallationReadInputDto, output: claudePluginInstallationDetailDto },
  "claude-plugin.install.report": { audience: "user" as const, kind: "write" as const, userScope: "dream:write", backgroundScope: null, input: claudePluginInstallReportInputDto, output: claudePluginOperationDto },
  "claude-plugin.installation.uninstall": { audience: "user" as const, kind: "write" as const, userScope: "dream:write", backgroundScope: null, input: claudePluginInstallationUninstallInputDto, output: claudePluginInstallationDto },
  "claude-plugin.builtin.ensure": { audience: "background" as const, kind: "write" as const, userScope: null, backgroundScope: "plugins:catalog" as const, input: claudePluginBuiltinEnsureInputDto, output: claudePluginBuiltinEnsureOutputDto },
  "claude-plugin.builtin.report": { audience: "background" as const, kind: "write" as const, userScope: null, backgroundScope: "plugins:catalog" as const, input: claudePluginInstallReportInputDto, output: claudePluginBuiltinReportOutputDto },
};

export type ClaudePluginOperation = keyof typeof claudePluginOperationContracts;
export type ClaudePluginBackgroundOperation = "claude-plugin.builtin.ensure" | "claude-plugin.builtin.report";
export type ClaudePluginInstallPrepareInput = z.infer<typeof claudePluginInstallPrepareInputDto>;
export type ClaudePluginInstallReportInput = z.infer<typeof claudePluginInstallReportInputDto>;
export type ClaudePluginInstallationEvidence = z.infer<typeof claudePluginInstallationEvidenceDto>;
