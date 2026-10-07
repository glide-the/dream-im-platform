// [Input] Administrator-owned same-model targets and a per-request random sample.
// [Output] Strict desired/effective routing DTOs and a bounded candidate order.
// [Pos] Shared routing policy contract; prices and credentials stay in their existing domains.
import { z } from "zod";

export const routingConfigSchema = z.object({
  strategy: z.enum(["ordered", "weighted"]),
  allowFallbacks: z.boolean(),
  targets: z.array(z.object({
    providerId: z.string().trim().min(1).max(200),
    upstreamModel: z.string().trim().min(1).max(200),
    weight: z.number().int().positive().max(1_000_000),
  }).strict()).min(1).max(32),
}).strict().superRefine((value, context) => {
  if (new Set(value.targets.map((target) => target.providerId)).size !== value.targets.length) {
    context.addIssue({ code: "custom", path: ["targets"], message: "每个 Provider 只能出现一次" });
  }
});
export const routingSaveSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().nonnegative(),
  status: z.enum(["draft", "active", "disabled"]),
  desired: routingConfigSchema,
}).strict();
export type RoutingConfig = z.infer<typeof routingConfigSchema>;
export type RoutingTarget = RoutingConfig["targets"][number];
export type RoutingSnapshot = {
  revision: number;
  strategy: "default" | RoutingConfig["strategy"];
  allowFallbacks: boolean;
  candidates: RoutingTarget[];
  excluded: Array<{ providerId: string; reason: string }>;
};

export type RoutingModelCapability = { capabilities: Record<string, boolean> | null; context_window: number | null; max_output_tokens: number | null };
export function targetSupportsModel(alias: RoutingModelCapability, target: RoutingModelCapability) {
  return Object.entries(alias.capabilities ?? {}).every(([key, enabled]) => !enabled || target.capabilities?.[key] === true)
    && (alias.context_window === null || target.context_window !== null && target.context_window >= alias.context_window)
    && (alias.max_output_tokens === null || target.max_output_tokens !== null && target.max_output_tokens >= alias.max_output_tokens);
}

export function orderRoutingTargets(config: RoutingConfig, targets: RoutingTarget[], sample = Math.random()) {
  if (config.strategy === "ordered" || targets.length < 2) return [...targets];
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Invalid routing sample");
  const total = targets.reduce((sum, target) => sum + target.weight, 0);
  let cursor = sample * total;
  let selected = targets.length - 1;
  for (let index = 0; index < targets.length; index++) {
    cursor -= targets[index].weight;
    if (cursor < 0) { selected = index; break; }
  }
  return [targets[selected], ...targets.filter((_, index) => index !== selected)];
}
