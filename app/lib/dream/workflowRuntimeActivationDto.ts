// [Input] Exact Run/Thread identity, observed SDK Thread reference and Dream-verified plugin identities.
// [Output] Strict authoritative Runtime activation projection with no filesystem or database selectors.
// [Pos] Registry108 DTO; Admin owns persistence while Dream owns workspace byte verification and Runtime.
// [Sync] 2026-09-15: define the atomic Story Workspace Runtime activation contract.
import { z } from "zod";

const identifier = z.string().min(1).max(255);
const runId = z.string().regex(/^run_[0-9a-f]{32}$/);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const workflowRuntimeVerifiedPluginDto = z.strictObject({
  package_spec: identifier,
  resolved_version: identifier,
  artifact_digest: digest,
  has_manifest: z.boolean(),
});

export const workflowRuntimeActivationInputDto = z.strictObject({
  thread_id: identifier,
  workflow_run_id: runId,
  remote_session_ref: z.string().trim().min(1).max(255),
  verified_plugins: z.array(workflowRuntimeVerifiedPluginDto),
});

export const workflowRuntimeActivationOutputDto = z.strictObject({
  thread_id: identifier,
  workflow_run_id: runId,
  workspace_id: identifier,
  runtime_plugin_lock_id: z.string().regex(/^rpl_[0-9a-f]{32}$/),
  runtime_load_receipt_id: z.string().regex(/^rlr_[0-9a-f]{32}$/),
  agent_session_id: z.string().regex(/^as_[0-9a-f]{32}$/),
  status: z.enum(["running", "output_validating", "pending_review", "confirmed"]),
  replayed: z.boolean(),
});

export const workflowRuntimeActivationPolicyDto = z.strictObject({
  runtime_environment_id: identifier,
  runtime_pool_id: identifier,
  runtime_node_id: identifier,
  distribution_mode: z.literal("local_persistent"),
  deployment_tier: z.literal("local"),
  policy_revision: identifier,
  materialization_key_scope: identifier,
  session_creating_lease_seconds: z.number().int().min(1).max(300),
  required_plugin_id: identifier,
  required_plugin_version: identifier,
  required_source_type: z.literal("platform-builtin"),
});

export const workflowRuntimeActivationOperationContracts = {
  "workflow-runtime.activate": {
    kind: "write" as const,
    userScope: "dream:write",
    input: workflowRuntimeActivationInputDto,
    output: workflowRuntimeActivationOutputDto,
  },
};

export type WorkflowRuntimeActivationInput = z.infer<typeof workflowRuntimeActivationInputDto>;
export type WorkflowRuntimeActivationOutput = z.infer<typeof workflowRuntimeActivationOutputDto>;
export type WorkflowRuntimeActivationPolicy = z.infer<typeof workflowRuntimeActivationPolicyDto>;
export type WorkflowRuntimeActivationOperation = keyof typeof workflowRuntimeActivationOperationContracts;
