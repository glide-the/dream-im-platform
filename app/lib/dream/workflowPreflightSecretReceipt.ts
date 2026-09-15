// [Input] Original server request bindings and one bounded complete Preflight response.
// [Output] AEAD-only durable response and strictly verified original recovery.
// [Pos] Internal secret receipt codec; tokens never enter plaintext receipt JSON or audit.
// [Sync] 2026-09-15: bind service/subject/input/PF/canonical owner/workspace before recovery.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { assertAuthEncryptionConfigured, decryptAuthBundle, encryptAuthBundle } from "../auth/tokenEncryption";
import { decimalIdDto, requestIdDto } from "../auth/dto";
import { workflowPreflightIdDto } from "./workflowPreflightDto";
import { workflowPreflightExecutionOutputDto, workflowPreflightSecretReceiptDto, type WorkflowPreflightExecutionOutput } from "./workflowPreflightExecutionDto";
export const preflightReceiptBindingDto = z.strictObject({ service_client_id: z.string().min(1), actor: z.string().min(1),
  operation: z.literal("workflow-preflight.execute"), request_id: requestIdDto, input_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  workflow_preflight_id: workflowPreflightIdDto, canonical_user_id: decimalIdDto, workspace_id: z.string().min(1) });
export type PreflightReceiptBinding = z.output<typeof preflightReceiptBindingDto>;
const encryptedBundleDto = preflightReceiptBindingDto.extend({ schema_version: z.literal(1), result: workflowPreflightExecutionOutputDto });
export class WorkflowPreflightSecretReceipt {
  constructor() { assertAuthEncryptionConfigured(); }
  store(rawBinding: PreflightReceiptBinding, rawResult: WorkflowPreflightExecutionOutput) {
    const binding = preflightReceiptBindingDto.parse(rawBinding), result = workflowPreflightExecutionOutputDto.parse(rawResult);
    this.assertResult(binding, result);
    return workflowPreflightSecretReceiptDto.parse({ format: "workflow-preflight/v1", ciphertext: encryptAuthBundle({ ...binding, schema_version: 1, result }) });
  }
  recover(rawBinding: PreflightReceiptBinding, rawStored: unknown) {
    try {
      const binding = preflightReceiptBindingDto.parse(rawBinding), stored = workflowPreflightSecretReceiptDto.parse(rawStored), bundle = encryptedBundleDto.parse(decryptAuthBundle(stored.ciphertext));
      for (const key of Object.keys(binding) as Array<keyof PreflightReceiptBinding>) if (bundle[key] !== binding[key]) throw new Error("Binding mismatch");
      this.assertResult(binding, bundle.result);
      return bundle.result;
    } catch { throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE"); }
  }
  private assertResult(binding: PreflightReceiptBinding, result: WorkflowPreflightExecutionOutput) {
    if (result.request_state !== "committed" || result.preflight.workflow_preflight_id !== binding.workflow_preflight_id || result.preflight.created_by !== binding.canonical_user_id) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
  }
}
