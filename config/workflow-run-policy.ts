// [Input] Original Workflow Run request/model protocol limits, independent of deployment or harness.
// [Output] Shared character limit counted as Unicode codepoints by the original Python contract.
// [Pos] Fixed business protocol policy; operational capacities remain in dream-domain-policy.
// [Sync] 2026-09-15: make the original 255-character idempotency-key rule explicit before create/retry.
export const workflowRunProtocolPolicy = Object.freeze({ idempotencyKeyMaxCharacters: 255 });
