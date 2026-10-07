// [Input] Strict policy DTOs, same-model capability contracts and deterministic routing samples.
// [Output] Duplicate/unknown input rejection, capability gates and stable ordered/weighted behavior.
// [Pos] Provider-free routing selection contract tests.
import { describe, expect, it } from "vitest";
import { orderRoutingTargets, routingSaveSchema, targetSupportsModel, type RoutingConfig } from "./routing-policy";
const config: RoutingConfig = { strategy: "weighted", allowFallbacks: true, targets: [
  { providerId: "a", upstreamModel: "model-a", weight: 1 }, { providerId: "b", upstreamModel: "model-b", weight: 3 },
] };
describe("same-model routing", () => {
  it("selects by explicit weights while retaining fallback order", () => {
    expect(orderRoutingTargets(config, config.targets, 0).map((target) => target.providerId)).toEqual(["a", "b"]);
    expect(orderRoutingTargets(config, config.targets, 0.25).map((target) => target.providerId)).toEqual(["b", "a"]);
    expect(orderRoutingTargets({ ...config, strategy: "ordered" }, config.targets, 0.9)).toEqual(config.targets);
    expect(orderRoutingTargets(config, [])).toEqual([]);
  });
  it("rejects unknown fields, duplicate providers, negative weights and missing CAS", () => {
    const dto = { modelId: "model", status: "active", expectedRevision: 0, desired: config };
    expect(routingSaveSchema.safeParse(dto).success).toBe(true);
    expect(routingSaveSchema.safeParse({ ...dto, actor: "forged" }).success).toBe(false);
    expect(routingSaveSchema.safeParse({ ...dto, desired: { ...config, targets: [config.targets[0], config.targets[0]] } }).success).toBe(false);
    expect(routingSaveSchema.safeParse({ ...dto, desired: { ...config, targets: [{ ...config.targets[0], weight: 0 }] } }).success).toBe(false);
    expect(routingSaveSchema.safeParse({ ...dto, expectedRevision: undefined }).success).toBe(false);
  });
  it("requires enabled alias capabilities and adequate windows", () => {
    const alias = { capabilities: { tools: true, vision: false }, context_window: 1000, max_output_tokens: 100 };
    expect(targetSupportsModel(alias, { ...alias, capabilities: { tools: true } })).toBe(true);
    expect(targetSupportsModel(alias, { ...alias, capabilities: {} })).toBe(false);
    expect(targetSupportsModel(alias, { ...alias, context_window: null })).toBe(false);
    expect(targetSupportsModel(alias, { ...alias, max_output_tokens: 99 })).toBe(false);
  });
});
