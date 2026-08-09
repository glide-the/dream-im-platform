import { z } from "zod";
import { productActions } from "./types";

const positivePage = z.coerce.number().int().min(1).max(1_000_000);
const pageSize = z.coerce.number().int().min(1).max(100);
const planVersionId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const expectedVersion = z.number().int().min(1).max(2_147_483_647);
const action = z.enum(productActions);

export const plansQuerySchema = z.strictObject({
  page: positivePage.default(1),
  pageSize: pageSize.default(20),
});

export const usageQuerySchema = z.strictObject({
  period: z.literal("current_subscription_period").default(
    "current_subscription_period",
  ),
  outcome: z
    .enum(["completed", "failed", "cancelled", "in_progress"])
    .optional(),
  modelAlias: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
    .optional(),
  gatewayScope: z
    .enum(["messages:create", "chat:create", "models:list"])
    .optional(),
  settlementState: z
    .enum(["settled", "usage_unknown", "in_progress", "rejected"])
    .optional(),
  sort: z
    .enum(["occurredAt", "totalTokens", "modelAlias", "outcome"])
    .default("occurredAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: positivePage.default(1),
  pageSize: pageSize.default(25),
});

export const emptyQuerySchema = z.strictObject({});

const previewCommandSchema = z
  .strictObject({
    action,
    phase: z.literal("preview"),
    targetPlanVersionId: planVersionId.optional(),
    expectedVersion: expectedVersion.nullable().optional(),
  })
  .superRefine((value, context) => {
    const requiresTarget = ["create", "upgrade", "downgrade"].includes(
      value.action,
    );
    if (requiresTarget !== (value.targetPlanVersionId !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["targetPlanVersionId"],
        message: requiresTarget
          ? "targetPlanVersionId is required for this action"
          : "targetPlanVersionId is not allowed for this action",
      });
    }
    if (value.action === "create") {
      if (value.expectedVersion !== undefined && value.expectedVersion !== null) {
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message: "expectedVersion must be null or omitted for create",
        });
      }
    } else if (value.expectedVersion === undefined || value.expectedVersion === null) {
      context.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "expectedVersion is required for this action",
      });
    }
  });

const executeCommandSchema = z
  .strictObject({
    action,
    phase: z.literal("execute"),
    targetPlanVersionId: planVersionId.optional(),
    expectedVersion: expectedVersion.nullable().optional(),
    previewId: z
      .string()
      .regex(/^preview_[A-Za-z0-9_-]{22}$/),
    digest: z.string().regex(/^sha256:[A-Za-z0-9_-]{43}$/),
    expiresAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((value, context) => {
    const requiresTarget = ["create", "upgrade", "downgrade"].includes(
      value.action,
    );
    if (requiresTarget !== (value.targetPlanVersionId !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["targetPlanVersionId"],
        message: requiresTarget
          ? "targetPlanVersionId is required for this action"
          : "targetPlanVersionId is not allowed for this action",
      });
    }
    if (value.action === "create") {
      if (value.expectedVersion !== undefined && value.expectedVersion !== null) {
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message: "expectedVersion must be null or omitted for create",
        });
      }
    } else if (value.expectedVersion === undefined || value.expectedVersion === null) {
      context.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "expectedVersion is required for this action",
      });
    }
  });

export const subscriptionCommandSchema = z.discriminatedUnion("phase", [
  previewCommandSchema,
  executeCommandSchema,
]);

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

export type PlansQuery = z.infer<typeof plansQuerySchema>;
export type UsageQuery = z.infer<typeof usageQuerySchema>;
export type SubscriptionCommand = z.infer<typeof subscriptionCommandSchema>;
export type PreviewSubscriptionCommand = z.infer<typeof previewCommandSchema>;
export type ExecuteSubscriptionCommand = z.infer<typeof executeCommandSchema>;
