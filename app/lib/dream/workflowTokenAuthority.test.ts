// [Input] Original fixed six-field Python HMAC vector with Unicode and exact UTC microseconds.
// [Output] Byte-identical pft/hash/consumption signatures, bounded verification and explicit config failures.
// [Pos] Provider-free signing compatibility test; fixture secrets never enter production defaults.
// [Sync] 2026-09-15: preserve original token bytes without JWT fallback or arbitrary signing API.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { workflowUtcMicroseconds } from "./workflowRunDto";
const secret = Buffer.from("0123456789abcdef0123456789abcdef");
const bindings = { workflow_preflight_id: `pf_${"a".repeat(32)}`, binding_revision: 7, input_hash: `sha256:${"b".repeat(64)}`,
  deck_runtime_snapshot_id: "snapshot_中文", runtime_plugin_lock_id: "lock_😀", expires_at: "2026-09-14T08:00:00.123456+08:00" };
// Generated once by original Python stdlib json.dumps(sort_keys=True,
// ensure_ascii=False,allow_nan=False,separators=(",",":")) and source HMAC.
const token = "pft_a7e_q2jk5jk910oYV46ODBbuFeR0966z9d5vnMLTNFg";
afterEach(() => vi.unstubAllEnvs());
describe("sole original Workflow token authority", () => {
  it("matches the complete original Python Unicode/UTC six-field token vector", () => {
    const authority = new WorkflowTokenAuthority(secret);
    expect(authority.issue(bindings)).toBe(token); expect(authority.verify(bindings, token)).toBe(true);
    expect(authority.tokenHash(token)).toBe("sha256:fb178264d0eadccf1fa3c59f027ad8d02b55b425a1ca873d936e690f883cd5be");
    expect(authority.consumptionDigest(token)).toBe("hmac-sha256:b39e3ebfe551bfc8563d008b496c1d3ad6dd27fc0e372780c1ecf3eb3c3e3144");
  });
  it.each(Object.keys(bindings) as (keyof typeof bindings)[])("rejects mutation of original %s binding", key => {
    const authority = new WorkflowTokenAuthority(secret);
    const changed = { ...bindings, [key]: key === "binding_revision" ? 8 : key === "expires_at" ? "2026-09-14T08:00:00.123457+08:00" : "changed" };
    expect(authority.verify(changed, token)).toBe(false);
  });
  it("rejects wrong length/signature/secret and preserves exact UTC fractions before the Unix epoch", () => {
    const authority = new WorkflowTokenAuthority(secret);
    for (const value of ["", `${token}x`, token.replace("pft_", "jwt_"), `${token.slice(0, -1)}x`]) expect(authority.verify(bindings, value)).toBe(false);
    expect(new WorkflowTokenAuthority(Buffer.from("different-original-secret-at-least-32-bytes")).verify(bindings, token)).toBe(false);
    expect(workflowUtcMicroseconds("1969-12-31T23:59:59.999999Z")).toBe("1969-12-31T23:59:59.999999+00:00");
    expect(workflowUtcMicroseconds("2026-09-14T08:00:00.1+08:00")).toBe("2026-09-14T00:00:00.100000+00:00");
  });
  it("requires an explicit Admin original secret and never adopts JWT_SECRET", () => {
    vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", ""); vi.stubEnv("JWT_SECRET", secret.toString());
    expect(() => new WorkflowTokenAuthority()).toThrow();
    vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", "short"); expect(() => new WorkflowTokenAuthority()).toThrow("WORKFLOW_TOKEN_AUTHORITY_NOT_CONFIGURED");
    vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", secret.toString()); expect(new WorkflowTokenAuthority().issue(bindings)).toBe(token);
    expect(() => new WorkflowTokenAuthority(Buffer.alloc(31))).toThrow("WORKFLOW_TOKEN_AUTHORITY_NOT_CONFIGURED");
  });
});
