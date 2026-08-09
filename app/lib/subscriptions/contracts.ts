import { z } from "zod";

const code = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalLimit = safeCount.nullable().optional();

export const planCreateSchema = z.strictObject({
  code,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).nullable().optional(),
});

export const planUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
  status: z.enum(["draft", "active", "retired"]).optional(),
});

export const planVersionCreateSchema = z.strictObject({
  planId: z.string().trim().min(1).max(100),
  priceMicrousd: safeCount.default(0),
  trialDays: z.number().int().min(0).max(365).default(0),
  gracePeriodDays: z.number().int().min(0).max(90).default(0),
  allowanceTokens: safeCount.positive().default(1),
});

export const planVersionUpdateSchema = planVersionCreateSchema
  .omit({ planId: true })
  .partial()
  .strict();

export const entitlementCreateSchema = z.strictObject({
  planVersionId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(100),
  gatewayScopes: z
    .array(z.enum(["messages:create", "chat:create", "models:list"]))
    .min(1)
    .max(3),
  requestsPerMinute: z.number().int().positive().nullable().optional(),
  dailyTokenLimit: optionalLimit,
  monthlyTokenLimit: optionalLimit,
  storageBytesLimit: optionalLimit,
  enabled: z.boolean().default(true),
});

export const entitlementUpdateSchema = entitlementCreateSchema
  .omit({ planVersionId: true, modelId: true })
  .partial()
  .strict();

export const subscriptionCreateSchema = z.strictObject({
  platformUserId: z.string().trim().min(1).max(100),
  planVersionId: z.string().trim().min(1).max(100),
  startsAt: z.iso.datetime().optional(),
  startInTrial: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(500),
});

export const subscriptionActionSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
  planVersionId: z.string().trim().min(1).max(100).optional(),
});

export const publishVersionSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(500),
});

export type SubscriptionResource =
  | "subscription-plans"
  | "subscription-plan-versions"
  | "subscription-entitlements"
  | "subscriptions"
  | "subscription-allowances"
  | "subscription-events";

const subscriptionResources = new Set<SubscriptionResource>([
  "subscription-plans",
  "subscription-plan-versions",
  "subscription-entitlements",
  "subscriptions",
  "subscription-allowances",
  "subscription-events",
]);

export function isSubscriptionResource(
  resource: string,
): resource is SubscriptionResource {
  return subscriptionResources.has(resource as SubscriptionResource);
}
