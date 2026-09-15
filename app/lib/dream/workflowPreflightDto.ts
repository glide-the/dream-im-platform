// [Input] Actor-free Preflight lookup and original fixed Preflight lifecycle fields.
// [Output] Closed status/snapshot/failure/time projection; active token remains owner-only.
// [Pos] Named authoritative Preflight contract, independent of Run/Runtime execution.
// [Sync] 2026-09-15: retain Pydantic model whitespace and passed-with-null-token exact-microsecond reads.
import { z } from "zod";
import { stripPydanticString } from "./deckPluginManifestDto";
import { workflowTimeDto, workflowTimestampMicros } from "./workflowRunDto";
const text = z.string().overwrite(stripPydanticString);
const identifier = text.min(1);
export const workflowPreflightIdDto = text.regex(/^pf_[0-9a-f]{32}$/);
export const workflowPreflightCheckDto = z.enum(["identity_workspace_permission", "binding_release", "manifest_workflow_schema", "host_agent_runtime_compatibility", "capability_source_policy", "deck_runtime_snapshot", "runtime_materialization", "token_issuance"]);
export const workflowPreflightDto = z.strictObject({
  workflow_preflight_id: workflowPreflightIdDto, deck_id: identifier, binding_revision: z.number().int().nonnegative().safe(),
  deck_plugin_id: identifier, deck_plugin_version: identifier, runtime_plugin_lock_id: identifier, deck_runtime_profile_id: identifier,
  deck_runtime_snapshot_id: text.nullable(), deck_runtime_snapshot_summary_hash: text.nullable(), input_hash: text.regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(["checking", "passed", "failed", "expired"]), error_code: text.nullable(), failed_check: workflowPreflightCheckDto.nullable(),
  expires_at: workflowTimeDto, preflight_token: text.nullable(), created_by: identifier, created_at: workflowTimeDto,
}).superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.status === "failed" ? value.error_code === null || value.failed_check === null : value.error_code !== null || value.failed_check !== null) invalid("Failure fields must match Preflight status.");
  if (value.status !== "passed" && value.preflight_token !== null) invalid("Only passed Preflights may expose a token.");
  if (value.status === "passed" && (value.deck_runtime_snapshot_id === null || value.deck_runtime_snapshot_summary_hash === null)) invalid("Passed Preflights require the original sanitized snapshot receipt.");
  if (workflowTimeDto.safeParse(value.expires_at).success && workflowTimeDto.safeParse(value.created_at).success && workflowTimestampMicros(value.expires_at) <= workflowTimestampMicros(value.created_at)) invalid("Preflight expiry must follow creation.");
});
export const workflowPreflightReadInputDto = z.strictObject({ workflow_preflight_id: workflowPreflightIdDto });
export const workflowPreflightReadOutputDto = z.strictObject({ preflight: workflowPreflightDto });
export const workflowPreflightOperationContracts = { "workflow-preflight.read": { kind: "read" as const, input: workflowPreflightReadInputDto, output: workflowPreflightReadOutputDto, userScope: "dream:read" } };
