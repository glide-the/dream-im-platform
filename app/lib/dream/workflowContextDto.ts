// [Input] One Thread ID; execution context is derived exclusively from stored business facts.
// [Output] Strict existing DreamRunContext or explicit ordinary-Chat null.
// [Pos] Named Workflow provenance contract; no request run/actor/Deck/retry selector.
// [Sync] 2026-09-14: preserve original context field bounds and positive binding revision.
import { z } from "zod";
import { stripPythonString } from "./deckPluginManifestDto";

const contextId = z.string().overwrite(stripPythonString).min(1).max(255);
export const workflowRunContextDto = z.strictObject({
  workflow_run_id: z.string().regex(/^run_[0-9a-f]{32}$/),
  thread_id: contextId,
  deck_id: contextId,
  agent_id: contextId.nullable(),
  deck_plugin_id: contextId,
  deck_plugin_version: contextId,
  deck_plugin_binding_id: contextId,
  binding_revision: z.number().int().positive().safe(),
  deck_runtime_snapshot_id: contextId,
  runtime_plugin_lock_id: contextId,
});
export const workflowContextInputDto = z.strictObject({ thread_id: z.string().min(1) });
export const workflowContextOutputDto = z.strictObject({ context: workflowRunContextDto.nullable() });
export const workflowContextOperationContracts = {
  "workflow-context.resolve": { kind: "read" as const, input: workflowContextInputDto, output: workflowContextOutputDto, userScope: "dream:read" },
};
export type WorkflowRunContext = z.infer<typeof workflowRunContextDto>;
