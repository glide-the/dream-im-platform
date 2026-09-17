// [Input] Admin route parameters and one explicit Dream product-role transition request.
// [Output] Strict Zod DTOs for canonical Dream user role mutation and its safe response projection.
// [Pos] Admin API contract boundary; it never accepts Admin membership, auth subject, email, table, or permission selectors.
// [Sync] 2026-09-17: add revision-like expected-role fencing for Dream product roles without joining Admin RBAC.
import { z } from "zod";

export const dreamCanonicalUserIdDto = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/, "Canonical Dream user id must be a positive decimal bigint");

export const dreamProductRoleDto = z.enum(["user", "admin"]);

export const dreamUserRoleMutationDto = z
  .object({
    expectedRole: dreamProductRoleDto,
    role: dreamProductRoleDto,
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((value) => value.expectedRole !== value.role, {
    message: "The target Dream product role must differ from expectedRole",
    path: ["role"],
  });

export const dreamUserRoleRecordDto = z
  .object({
    id: dreamCanonicalUserIdDto,
    email: z.string().email(),
    display_name: z.string().nullable(),
    role: dreamProductRoleDto,
    updated_at: z.string().min(1),
  })
  .strict();

export const dreamUserRoleMutationResultDto = z
  .object({
    user: dreamUserRoleRecordDto,
    idempotent: z.boolean(),
  })
  .strict();

export type DreamProductRole = z.infer<typeof dreamProductRoleDto>;
export type DreamUserRoleMutation = z.infer<typeof dreamUserRoleMutationDto>;
export type DreamUserRoleRecord = z.infer<typeof dreamUserRoleRecordDto>;
export type DreamUserRoleMutationResult = z.infer<typeof dreamUserRoleMutationResultDto>;
