// [Input] Verified service-bound OAuth principal and a strict owner-only Preflight lookup.
// [Output] Original lifecycle projection and re-issued token only while passed, unconsumed and unexpired.
// [Pos] Admin-owned Preflight read/signing orchestration; no new Run or implicit expiry write.
// [Sync] 2026-09-15: sign original raw stored bindings independently of output string normalization.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { WorkflowPreflightRepository } from "./workflowPreflightRepository";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { projectWorkflowTimestamp } from "./workflowRunService";
import { workflowTimeDto, workflowTimestampMicros } from "./workflowRunDto";
import { workflowPreflightReadInputDto, workflowPreflightDto, workflowPreflightReadOutputDto } from "./workflowPreflightDto";
export async function readWorkflowPreflight(tx: DataTransaction, rawInput: unknown, rawPrincipal: PrincipalDto) {
  const parsed = workflowPreflightReadInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes("dream:read")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const authority = new WorkflowTokenAuthority();
  const row = await new WorkflowPreflightRepository(tx).read(principal.canonical_user_id, parsed.data.workflow_preflight_id);
  if (!row || row.created_by !== principal.canonical_user_id || row.workflow_preflight_id !== parsed.data.workflow_preflight_id) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
  try {
    const { consumed_at, clock, ...fields } = row;
    const preflight = workflowPreflightDto.parse({ ...fields, expires_at: projectWorkflowTimestamp(row.expires_at), created_at: projectWorkflowTimestamp(row.created_at), preflight_token: null });
    if (consumed_at !== null) workflowTimeDto.parse(projectWorkflowTimestamp(consumed_at));
    const now = workflowTimeDto.parse(projectWorkflowTimestamp(clock));
    const active = preflight.status === "passed" && consumed_at === null && workflowTimestampMicros(preflight.expires_at) > workflowTimestampMicros(now);
    return workflowPreflightReadOutputDto.parse({ preflight: { ...preflight, preflight_token: active ? authority.issueStored({ ...row, deck_runtime_snapshot_id: row.deck_runtime_snapshot_id! }) : null } });
  } catch { throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_DATA_INVALID"); }
}
