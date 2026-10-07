// [Input] Named display windows and safe aggregate Gateway observations.
// [Output] Strict health query DTO and shared read-only response types.
// [Pos] Presentation contract, independent of routing decision and billing policies.
import { z } from "zod";
import { routingHealthPolicy, routingHealthWindows } from "../../../config/routing-health-policy";
import type { RoutingConfig } from "./routing-policy";

export const routingHealthQuerySchema = z.strictObject({
  window: z.enum(routingHealthWindows.map(option => option.value)).default(routingHealthPolicy.defaultWindow),
  providerPage: z.string().regex(/^[1-9]\d*$/).transform(Number)
    .refine(value => Number.isSafeInteger(value) && value <= Math.floor(Number.MAX_SAFE_INTEGER / routingHealthPolicy.providerPageSize)).default(1),
});
export const routingHealthModelIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
export type RoutingHealthQuery = z.infer<typeof routingHealthQuerySchema>;
export type HealthPerformance = { samples: number; p50Ms: number | null; p95Ms: number | null };
export type HealthCounts = {
  requests: number; succeeded: number; failed: number; cancelled: number; pending: number;
  successRate: number | null; latency: HealthPerformance; firstToken: HealthPerformance;
};
export type RoutingHealthPoint = HealthCounts & { at: string };
export type RoutingHealthProvider = HealthCounts & {
  providerId: string; providerName: string; providerStatus: string; upstreamModel: string;
  current: boolean; lastObservedAt: string | null;
};
export type RoutingHealthData = {
  model: { id: string; code: string; displayName: string };
  policy: { status: "draft" | "active" | "disabled"; revision: number; effective: RoutingConfig | null };
  currentTargets: { providerId: string; providerName: string; upstreamModel: string; providerStatus: string }[];
  summary: HealthCounts & { recovered: number; lastObservedAt: string | null };
  timeline: RoutingHealthPoint[];
  providers: RoutingHealthProvider[];
  meta: { window: RoutingHealthQuery["window"]; from: string; to: string; generatedAt: string; bucketSeconds: number; providerPage: number; providerPageSize: number; providerTotal: number };
};
