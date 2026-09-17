// [Input] Complete original token-bearing response and explicit test-only AEAD key.
// [Output] Actual encryption/tamper/binding/expired-original recovery evidence.
// [Pos] Provider-free secret boundary verification; no database or credential fixtures.
// [Sync] 2026-09-15: verify every original authority binding without token resurrection.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptAuthBundle, encryptAuthBundle } from "../auth/tokenEncryption";
import { WorkflowPreflightSecretReceipt, type PreflightReceiptBinding } from "./workflowPreflightSecretReceipt";
import type { WorkflowPreflightExecutionOutput } from "./workflowPreflightExecutionDto";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { projectWorkflowTimestamp } from "./workflowRunService";
const row = validWorkflowPreflightRow();
const binding: PreflightReceiptBinding = { service_client_id: "service", actor: "subject", operation: "workflow-preflight.execute", request_id: "original",
  input_sha256: "a".repeat(64), workflow_preflight_id: row.workflow_preflight_id, canonical_user_id: row.created_by, workspace_id: "workspace" };
function result(): WorkflowPreflightExecutionOutput {
  const { consumed_at: _consumed, clock: _clock, ...fields } = row;
  return { request_state: "committed", preflight: { ...fields, status: "passed", failed_check: null,
    expires_at: projectWorkflowTimestamp(row.expires_at)!, created_at: projectWorkflowTimestamp(row.created_at)!, preflight_token: "pft_original-bounded" } };
}
beforeEach(() => vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", "a".repeat(64)));
afterEach(() => vi.unstubAllEnvs());
describe("encrypted original Preflight receipt", () => {
  it("uses actual AEAD and recovers the exact bounded expired response", () => {
    const cipher = new WorkflowPreflightSecretReceipt(), original = result(), stored = cipher.store(binding, original);
    expect(JSON.stringify(stored)).not.toContain(original.preflight.preflight_token);
    expect(JSON.stringify(stored)).not.toContain(row.deck_runtime_snapshot_id);
    expect(cipher.recover(binding, stored)).toEqual(original);
    expect(cipher.store(binding, original).ciphertext).not.toBe(stored.ciphertext);
  });
  it.each(["service_client_id", "actor", "request_id", "input_sha256", "workflow_preflight_id", "canonical_user_id", "workspace_id"] as const)("rejects changed %s authority", key => {
    const cipher = new WorkflowPreflightSecretReceipt(), stored = cipher.store(binding, result());
    const value = key === "input_sha256" ? "b".repeat(64) : key === "workflow_preflight_id" ? `pf_${"b".repeat(32)}` : key === "canonical_user_id" ? "42" : "changed";
    expect(() => cipher.recover({ ...binding, [key]: value }, stored)).toThrowError(expect.objectContaining({ code: "WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE", status: 503 }));
  });
  it("rejects corrupted ciphertext, wrong key, malformed encoding and unexpected encrypted fields", () => {
    const cipher = new WorkflowPreflightSecretReceipt(), stored = cipher.store(binding, result());
    expect(() => cipher.recover(binding, { ...stored, ciphertext: stored.ciphertext.slice(0, -3) })).toThrow();
    expect(() => cipher.recover(binding, { ...stored, plaintext: "pft" })).toThrow();
    const bundle = decryptAuthBundle(stored.ciphertext) as Record<string, unknown>;
    expect(() => cipher.recover(binding, { ...stored, ciphertext: encryptAuthBundle({ ...bundle, unexpected: true }) })).toThrow();
    expect(() => cipher.recover(binding, { ...stored, ciphertext: encryptAuthBundle({ ...bundle, operation: "different" }) })).toThrow();
    vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", "b".repeat(64)); expect(() => cipher.recover(binding, stored)).toThrow();
  });
  it("refuses uncommitted or differently owned responses and validates configuration before writes", () => {
    const cipher = new WorkflowPreflightSecretReceipt();
    expect(() => cipher.store(binding, { ...result(), request_state: "in_progress" })).toThrow();
    expect(() => cipher.store(binding, { ...result(), preflight: { ...result().preflight, created_by: "42" } })).toThrow();
    vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", ""); expect(() => new WorkflowPreflightSecretReceipt()).toThrow();
  });
});
