// [Input] Registered supply models and saved/edited routing configurations without any upstream or DB.
// [Output] Dropdown compatibility and default/ordered/weighted preview semantic regression evidence.
// [Pos] Provider-free presentation contract tests; server policy tests remain separate.
import { describe, expect, it } from "vitest";
import { compatibleRoutingModels, routingPreview, routingSelectionSummary, type RoutingModelOption } from "./routingPreview";
import type { RoutingConfig } from "@/lib/models/routing-policy";

const alias: RoutingModelOption = { id: "alias", code: "public-model", provider_id: "first", upstream_model: "model-a", display_name: "Alias", enabled: true, capabilities: { chat: true, tools: true }, context_window: 1000, max_output_tokens: 100 };
const supply = (patch: Partial<RoutingModelOption>): RoutingModelOption => ({ ...alias, id: "supply", provider_id: "second", upstream_model: "model-b", ...patch });
const config: RoutingConfig = { strategy: "ordered", allowFallbacks: false, targets: [{ providerId: "first", upstreamModel: "model-a", weight: 1 }, { providerId: "second", upstreamModel: "model-b", weight: 3 }] };
const name = (id: string) => ({ first: "First", second: "Second" })[id as "first" | "second"] ?? id;

describe("routing presentation", () => {
  it("only offers the selected Provider's enabled capability-compatible models", () => {
    const models = [alias, supply({}), supply({ id: "disabled", upstream_model: "off", enabled: false }), supply({ id: "no-tools", upstream_model: "no-tools", capabilities: { chat: true } }), supply({ id: "short", upstream_model: "short", context_window: 999 }), supply({ id: "small-output", upstream_model: "small", max_output_tokens: 99 })];
    expect(compatibleRoutingModels(alias, "second", models).map(model => model.upstream_model)).toEqual(["model-b"]);
    expect(compatibleRoutingModels(alias, "missing", models)).toEqual([]);
  });
  it("deduplicates model aliases that refer to the same upstream supply", () => {
    expect(compatibleRoutingModels(alias, "second", [supply({}), supply({ id: "other-alias", code: "another-public-alias" })])).toHaveLength(1);
  });
  it("does not imply failover merely because two ordered targets exist", () => {
    const preview = routingPreview(config);
    expect(preview).toMatchObject({ valid: true, strategy: "ordered", allowFallbacks: false });
    expect(routingSelectionSummary(preview, name)).toBe("按序选择首个可用候选：First → Second；不执行跨 Provider 后备");
    expect(routingSelectionSummary(routingPreview({ ...config, allowFallbacks: true }), name)).toContain("允许明确拒绝后的后备");
  });
  it("describes weighted routing as primary selection rather than fixed traversal", () => {
    expect(routingSelectionSummary(routingPreview({ ...config, strategy: "weighted" }), name)).toBe("按权重选择首选：First、Second；不执行跨 Provider 后备");
  });
  it("projects inactive policies to the default target even when desired has multiple targets", () => {
    const preview = routingPreview(null, { providerId: "first", upstreamModel: "model-a" });
    expect(preview).toMatchObject({ valid: true, strategy: "default", allowFallbacks: false, targets: [{ providerId: "first", upstreamModel: "model-a" }] });
    expect(routingSelectionSummary(preview, name)).toBe("仅使用默认 Provider：First · model-a");
  });
  it("does not generate a valid route for empty, duplicate or invalid weighted input", () => {
    expect(routingPreview({ ...config, targets: [] }).valid).toBe(false);
    expect(routingPreview({ ...config, targets: [config.targets[0], config.targets[0]] }).valid).toBe(false);
    expect(routingPreview({ ...config, targets: [{ ...config.targets[0], upstreamModel: "" }] }).valid).toBe(false);
    expect(routingPreview({ ...config, targets: [{ ...config.targets[0], weight: 0 }] }).valid).toBe(false);
    expect(routingPreview(null).valid).toBe(false);
    expect(routingSelectionSummary(routingPreview(null), name)).toContain("请补全");
  });
});
