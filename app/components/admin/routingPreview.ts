// [Input] Safe registered model DTOs and desired/effective same-model routing configuration.
// [Output] Compatible upstream dropdown options and deterministic explanatory previews.
// [Pos] Presentation helpers; Gateway and Admin remain authoritative for availability and validation.
import { routingConfigSchema, targetSupportsModel, type RoutingConfig, type RoutingModelCapability } from "@/lib/models/routing-policy";

export type RoutingModelOption = RoutingModelCapability & {
  id: string;
  code: string;
  provider_id: string;
  upstream_model: string;
  display_name: string;
  enabled: boolean;
};
export type RoutingProviderOption = { id: string; name: string; protocol: string; adapter_kind: string; status: string };
export type DefaultRoutingTarget = { providerId: string; upstreamModel: string };

export function compatibleRoutingModels(alias: RoutingModelCapability, providerId: string, models: RoutingModelOption[]) {
  const unique = new Map<string, RoutingModelOption>();
  for (const model of models) {
    if (model.provider_id === providerId && model.enabled && targetSupportsModel(alias, model)) {
      if (!unique.has(model.upstream_model)) unique.set(model.upstream_model, model);
    }
  }
  return [...unique.values()];
}

export function routingPreview(config: RoutingConfig | null, defaultTarget?: DefaultRoutingTarget) {
  if (config === null) return {
    strategy: "default" as const, allowFallbacks: false,
    targets: defaultTarget ? [{ ...defaultTarget, weight: 1 }] : [], valid: Boolean(defaultTarget),
  };
  const parsed = routingConfigSchema.safeParse(config);
  return { ...config, valid: parsed.success };
}

export function routingSelectionSummary(preview: ReturnType<typeof routingPreview>, name: (id: string) => string) {
  if (!preview.valid) return "请补全候选 Provider、上游型号与有效权重";
  if (preview.strategy === "default") return `仅使用默认 Provider：${name(preview.targets[0].providerId)} · ${preview.targets[0].upstreamModel}`;
  const selection = preview.strategy === "ordered"
    ? `按序选择首个可用候选：${preview.targets.map(target => name(target.providerId)).join(" → ")}`
    : `按权重选择首选：${preview.targets.map(target => name(target.providerId)).join("、")}`;
  return `${selection}；${preview.allowFallbacks && preview.targets.length > 1 ? "允许明确拒绝后的后备" : "不执行跨 Provider 后备"}`;
}
