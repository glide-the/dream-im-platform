// [Input] Closed actor-scoped Deck Plugin control selectors, commands and Dream-verified local artifact evidence.
// [Output] Strict installation views, immutable plans and lifecycle receipts matching Dream's public control plane.
// [Pos] Registry170-174 DTO contract; actor, SQL, table, column and transaction selectors are absent.
// [Sync] 2026-09-16: define the Admin-owned Deck Plugin installation/materialization aggregate.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { deckPluginManifestDto, stripPydanticString } from "./deckPluginManifestDto";

const text = z.string().overwrite(stripPydanticString).min(1);
const identifier = text.max(255);
const pluginId = deckPluginManifestDto.shape.deck_plugin_id;
const version = deckPluginManifestDto.shape.deck_plugin_version;
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const installationId = z.string().regex(/^dpi_[0-9a-f]{32}$/);
const lockId = z.string().regex(/^rpl_[0-9a-f]{32}$/);
const revision = z.number().int().nonnegative().safe();
const scope = { scope_type: z.enum(["instance", "workspace"]), scope_id: identifier };
const actionScope = { ...scope, deck_plugin_id: pluginId };
const runtimeAction = z.enum(["install", "upgrade", "approve_upgrade", "rollback", "reconcile"]);
const installationStatus = z.enum(["installing", "ready", "disabled", "error", "upgrade_pending", "uninstalled"]);

export const deckPluginControlListInputDto = z.strictObject(scope);
export const deckPluginControlVersionInputDto = z.strictObject({ ...actionScope, deck_plugin_version: version });
export const deckPluginControlReadinessInputDto = z.strictObject(actionScope);

const installCommand = z.strictObject({ action: z.literal("install"), ...actionScope, deck_plugin_version: version,
  source_type: z.enum(["marketplace", "controlled", "local"]), source: text.max(2048) });
const enableCommand = z.strictObject({ action: z.literal("enable"), ...actionScope });
const disableCommand = z.strictObject({ action: z.literal("disable"), ...actionScope, reason: text.max(500) });
const upgradeCommand = z.strictObject({ action: z.literal("upgrade"), ...actionScope, target_version: version });
const rollbackCommand = z.strictObject({ action: z.literal("rollback"), ...actionScope, target_version: version });
const approveCommand = z.strictObject({ action: z.literal("approve_upgrade"), ...actionScope });
const rejectCommand = z.strictObject({ action: z.literal("reject_upgrade"), ...actionScope });
const uninstallCommand = z.strictObject({ action: z.literal("uninstall"), ...actionScope, purge: z.boolean() });
const reconcileCommand = z.strictObject({ action: z.literal("reconcile"), ...actionScope });

export const deckPluginControlCommandDto = z.discriminatedUnion("action", [installCommand, enableCommand,
  disableCommand, upgradeCommand, rollbackCommand, approveCommand, rejectCommand, uninstallCommand, reconcileCommand]);
export const deckPluginControlPlanInputDto = deckPluginControlCommandDto;

export const deckPluginControlCapabilityDiffDto = z.strictObject({ added: z.array(text), removed: z.array(text) });
export const deckPluginControlRuntimeTargetDto = z.strictObject({
  runtime_plugin_lock_id: lockId,
  deck_plugin_manifest_hash: digest,
  artifact_set_hash: digest,
  entries: z.array(z.strictObject({
    claude_code_plugin_id: identifier,
    resolved_version: version,
    source_ref: text.max(2048),
    artifact_digest: digest,
    required: z.boolean(),
  })),
});

export const deckPluginControlPlanDto = z.strictObject({
  command: deckPluginControlCommandDto,
  expected_revision: revision.nullable(),
  deck_plugin_installation_id: installationId.nullable(),
  target_version: version.nullable(),
  source_policy_id: text.max(2304).nullable(),
  capability_diff: deckPluginControlCapabilityDiffDto,
  requires_runtime_evidence: z.boolean(),
  runtime_target: deckPluginControlRuntimeTargetDto.nullable(),
}).superRefine((value, context) => {
  const needs = value.requires_runtime_evidence;
  if (needs !== (value.runtime_target !== null)) context.addIssue({ code: "custom", message: "Runtime target must match evidence requirement." });
  if ((value.expected_revision === null) !== (value.deck_plugin_installation_id === null)
    || (value.command.action !== "install" && value.expected_revision === null)) {
    context.addIssue({ code: "custom", message: "Installation identity and revision must match the command." });
  }
});

export const deckPluginControlEvidenceDto = z.strictObject({
  claude_code_plugin_id: identifier,
  resolved_version: version,
  artifact_digest: digest,
  materialized_digest: digest,
  cache_ref: text.max(4096),
  has_manifest: z.literal(true),
});
export const deckPluginControlApplyInputDto = z.strictObject({
  plan: deckPluginControlPlanDto,
  evidence: z.array(deckPluginControlEvidenceDto),
});

export const deckPluginRuntimeViewDto = z.strictObject({
  claude_code_plugin_id: identifier,
  resolved_version: version,
  version_constraint: version,
  artifact_digest: digest,
  declaration_status: z.enum(["undeclared", "declared", "disabled"]),
  materialization_status: z.enum(["missing", "materializing", "materialized", "failed"]),
  activation_status: z.enum(["inactive", "loadable", "loaded", "load_failed"]),
  health_status: z.enum(["healthy", "failed", "unknown"]),
  last_error_code: identifier.nullable(),
  last_error_summary: z.string().nullable(),
  updated_at: isoTimeDto.nullable(),
});
export const deckPluginRuntimeReadinessDto = z.strictObject({
  declaration_status: z.enum(["undeclared", "declared", "disabled"]),
  materialization_status: z.enum(["missing", "materializing", "materialized", "failed"]),
  activation_status: z.enum(["inactive", "loadable", "loaded", "load_failed"]),
});
export const deckPluginControlViewDto = z.strictObject({
  deck_plugin_installation_id: z.union([installationId, z.string().regex(/^preview:/)]),
  deck_plugin_id: pluginId,
  display_name: z.string(),
  deck_plugin_version: version,
  installed_versions: z.array(version),
  default_version: version.nullable(),
  available_version: version.nullable(),
  status: installationStatus,
  source: z.strictObject({ type: z.literal("controlled"), label: text, verified: z.literal(true) }),
  approved_capabilities: z.array(text),
  capabilities: z.strictObject({ manifest_requested: z.array(text), effective: z.array(text) }),
  compatibility: z.strictObject({ passed: z.boolean(), status: z.enum(["compatible", "pending"]), effective_capabilities: z.array(text) }),
  runtime_readiness: deckPluginRuntimeReadinessDto,
  health_status: z.enum(["healthy", "unknown"]),
  last_error_code: identifier.nullable(),
  last_error_summary: z.string().nullable(),
  updated_at: isoTimeDto,
  rollback_versions: z.array(version),
  manifest: z.strictObject({ schema_version: z.literal("deck-plugin/v1"), author: z.string(), workflow_references: z.array(text),
    input_schema_version: text, output_schema_version: text, deck_runtime_contract: text, capabilities: z.array(text) }),
  runtime_plugins: z.array(deckPluginRuntimeViewDto),
  history: z.array(z.never()), recent_runs: z.array(z.never()), operation_logs: z.array(z.never()),
  is_system: z.boolean(),
});
export const deckPluginControlListDto = z.strictObject({ installations: z.array(deckPluginControlViewDto), runtime_plugins: z.array(deckPluginRuntimeViewDto) });

export const deckPluginControlOperationDto = z.strictObject({
  operation_id: z.string().regex(/^op_[0-9a-f]{32}$/),
  deck_plugin_id: pluginId,
  target_version: version.nullable(),
  status: z.literal("completed"),
  phase: z.enum(["ready", "upgrade_pending"]),
  progress: z.literal(100),
  message: text,
  updated_at: isoTimeDto,
});

export const deckPluginControlOperationContracts = {
  "deck-plugin-control.list": { kind: "read" as const, userScope: "dream:read", input: deckPluginControlListInputDto, output: deckPluginControlListDto },
  "deck-plugin-control.version": { kind: "read" as const, userScope: "dream:read", input: deckPluginControlVersionInputDto, output: deckPluginControlViewDto },
  "deck-plugin-control.readiness": { kind: "read" as const, userScope: "dream:read", input: deckPluginControlReadinessInputDto, output: deckPluginRuntimeReadinessDto },
  "deck-plugin-control.plan": { kind: "read" as const, userScope: "dream:write", input: deckPluginControlPlanInputDto, output: deckPluginControlPlanDto },
  "deck-plugin-control.apply": { kind: "write" as const, userScope: "dream:write", input: deckPluginControlApplyInputDto, output: deckPluginControlOperationDto },
};

export type DeckPluginControlOperation = keyof typeof deckPluginControlOperationContracts;
export type DeckPluginControlCommand = z.infer<typeof deckPluginControlCommandDto>;
export type DeckPluginControlPlan = z.infer<typeof deckPluginControlPlanDto>;
export type DeckPluginControlApplyInput = z.infer<typeof deckPluginControlApplyInputDto>;
export type DeckPluginControlEvidence = z.infer<typeof deckPluginControlEvidenceDto>;
export type DeckPluginControlRuntimeTarget = z.infer<typeof deckPluginControlRuntimeTargetDto>;
