// [Input] Existing resource-policy business precision rules and domain DTO examples.
// [Output] Success/invalid/missing policy state and forbidden identity/body field coverage.
// [Pos] Deterministic domain wire-contract verification, no database or providers.
import { describe, expect, it } from "vitest";
import { resourcePolicyReadInputDto, resourcePolicyReadOutputDto } from "./resourceDto";
import { claudeAgentResourcePolicy as policy } from "../../../config/claude-agent-resource-policy";
describe("resource policy domain DTO", () => {
  it("retains optional effort, precise positive values and stable revision", () => {
    const value = { schemaVersion: 1, revision: 2, ...policy.defaults };
    expect(resourcePolicyReadOutputDto.parse({ status: "configured", value, updated_at: "2026-09-14T00:00:00Z" }).status).toBe("configured");
    const unset = { ...value }; delete (unset as { claudeCodeEffortLevel?: unknown }).claudeCodeEffortLevel;
    expect(resourcePolicyReadOutputDto.safeParse({ status: "configured", value: unset, updated_at: "2026-09-14T00:00:00Z" }).success).toBe(true);
  });
  it("represents illegal/missing desired policy without becoming transport errors", () => {
    for (const status of ["not_configured", "invalid"]) expect(resourcePolicyReadOutputDto.parse({ status, value: null, updated_at: null }).status).toBe(status);
    expect(resourcePolicyReadOutputDto.safeParse({ status: "invalid", value: { arbitrary: true }, updated_at: null }).success).toBe(false);
  });
  it("rejects precision overflow, zero revision and caller identity", () => {
    for (const patch of [{ revision: 0 }, { maxConcurrentRuns: Number.MAX_SAFE_INTEGER + 1 }, { runMemoryBudgetMib: policy.technicalLimits.maxCombinedMemoryMib, memoryReserveMib: 1 }]) {
      expect(resourcePolicyReadOutputDto.safeParse({ status: "configured", value: { schemaVersion: 1, revision: 1, ...policy.defaults, ...patch }, updated_at: "2026-09-14T00:00:00Z" }).success).toBe(false);
    }
    expect(resourcePolicyReadInputDto.safeParse({ request_id: "resource_1", user_id: "1" }).success).toBe(false);
  });
});
