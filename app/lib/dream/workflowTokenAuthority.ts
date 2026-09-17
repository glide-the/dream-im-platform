// [Input] Admin-only explicit original Workflow secret and the six fixed stored Preflight token bindings.
// [Output] Original pft HMAC bytes, constant-time verification and run-consumption digest; no plaintext storage.
// [Pos] Sole Workflow signing authority; no JWT/Dream secret fallback or arbitrary signing endpoint.
// [Sync] 2026-09-15: sign raw stored opaque bindings before output normalization, preserving original UTC microseconds.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { workflowUtcMicroseconds } from "./workflowRunDto";
import { pgTimestampToIso } from "./chatThreadDto";

type PreflightTokenBindings = { workflow_preflight_id: string; binding_revision: number; input_hash: string; deck_runtime_snapshot_id: string; runtime_plugin_lock_id: string; expires_at: string };
function configuredSecret() {
  const value = Buffer.from(requiredAuthValue("INK_WORKFLOW_TOKEN_SECRET"), "utf8");
  if (value.length < 32) throw new AuthBoundaryError("WORKFLOW_TOKEN_AUTHORITY_NOT_CONFIGURED");
  return value;
}
export class WorkflowTokenAuthority {
  constructor(private readonly secret: Buffer = configuredSecret()) {
    if (secret.length < 32) throw new AuthBoundaryError("WORKFLOW_TOKEN_AUTHORITY_NOT_CONFIGURED");
  }
  issue(bindings: PreflightTokenBindings) {
    // All keys are fixed ASCII and all values are validated strings/int4. This
    // ordered object retains Python sort_keys/ensure_ascii=False JSON bytes;
    // arbitrary numeric business JSON still uses the shared Python codec.
    const payload = JSON.stringify({ binding_revision: bindings.binding_revision, deck_runtime_snapshot_id: bindings.deck_runtime_snapshot_id,
      expires_at: workflowUtcMicroseconds(bindings.expires_at), input_hash: bindings.input_hash, preflight_id: bindings.workflow_preflight_id,
      runtime_plugin_lock_id: bindings.runtime_plugin_lock_id });
    return `pft_${createHmac("sha256", this.secret).update(payload, "utf8").digest("base64url")}`;
  }
  issueStored(bindings: PreflightTokenBindings) {
    // Original _token_from_row signs database strings before Pydantic strips
    // output fields. Only timestamp serialization is canonicalized here.
    return this.issue({ ...bindings, expires_at: pgTimestampToIso(bindings.expires_at)! });
  }
  verify(bindings: PreflightTokenBindings, token: string) {
    const expected = Buffer.from(this.issue(bindings), "utf8"), actual = Buffer.from(token, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  consumptionDigest(token: string) { return `hmac-sha256:${createHmac("sha256", this.secret).update("workflow-run-token\0", "utf8").update(token, "utf8").digest("hex")}`; }
  tokenHash(token: string) { return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`; }
}
