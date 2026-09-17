// [Input] Owned workspace/Deck/revision and raw object JSON; actor and check facts are server-derived.
// [Output] Original Preflight projection with explicit original-request execution evidence.
// [Pos] Closed staged execution contract; secret receipt encoding stays internal.
// [Sync] 2026-09-15: distinguish an executing original request from a committed bounded result.
import { z } from "zod";
import { stripPydanticString, stripPythonString } from "./deckPluginManifestDto";
import { workflowPreflightDto } from "./workflowPreflightDto";
import { requestIdDto } from "../auth/dto";
const identifier = z.string().overwrite(stripPydanticString).min(1).refine(value => stripPythonString(value) !== "");
const objectJson = z.string().refine(value => {
  try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed); } catch { return false; }
});
export const workflowPreflightExecutionInputDto = z.strictObject({ workspace_id: identifier, deck_id: identifier,
  binding_revision: z.number().int().nonnegative().safe(), input_json: objectJson });
export const workflowPreflightExecutionOutputDto = z.strictObject({ request_state: z.enum(["in_progress", "committed"]), preflight: workflowPreflightDto })
  .refine(value => value.request_state !== "in_progress" || value.preflight.status === "checking", "In-progress evidence must retain checking status.");
export const workflowPreflightSecretReceiptDto = z.strictObject({ format: z.literal("workflow-preflight/v1"), ciphertext: z.string().min(1) });
export const workflowPreflightOriginalReceiptDto = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("absent"), operation: z.literal("workflow-preflight.execute"), request_id: requestIdDto }),
  z.strictObject({ status: z.literal("in_progress"), operation: z.literal("workflow-preflight.execute"), request_id: requestIdDto, result: workflowPreflightExecutionOutputDto }),
  z.strictObject({ status: z.literal("committed"), operation: z.literal("workflow-preflight.execute"), request_id: requestIdDto, result: workflowPreflightExecutionOutputDto }),
]).refine(value => value.status === "absent" || value.result.request_state === value.status, "Receipt evidence must match original request state.");
export const workflowPreflightExecutionOperationContracts = { "workflow-preflight.execute": { kind: "write" as const,
  input: workflowPreflightExecutionInputDto, output: workflowPreflightExecutionOutputDto, userScope: "dream:write" } };
export type WorkflowPreflightExecutionInput = z.output<typeof workflowPreflightExecutionInputDto>;
export type WorkflowPreflightExecutionOutput = z.output<typeof workflowPreflightExecutionOutputDto>;
