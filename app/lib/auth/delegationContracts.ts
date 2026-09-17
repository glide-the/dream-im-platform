// [Input] Actual strict delegation DTOs and exact identity/delegation/purpose capabilities.
// [Output] Version/hash/method/path discovery for implemented special routes only.
// [Pos] Dedicated authentication API registry; never dispatched through generic data operations.
// [Sync] 2026-09-16: require live Reflections-authority source fencing before advertising creation.
// [Sync] 2026-09-14: advertise Runtime readiness independently of data registry availability.
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "../dream/operationRegistry";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, runtimeReflectionAuthoritySchemaRequirement } from "../dream/schemaRequirements";
import { delegationCreateInputDto, delegationOutputDto, delegationActionRequestDto, delegationRenewOutputDto, delegationRevokeOutputDto, delegationReceiptInputDto, delegationReceiptOutputDto } from "./delegationDto";
import { dreamUnifiedSchemaRequirement } from "../dream/chatThreadService";
export const delegationSchemaRequirements = [identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, runtimeReflectionAuthoritySchemaRequirement] as const;
function descriptor(name: string, method: "POST" | "GET", path: string, input: z.ZodType, output: z.ZodType) {
  const contract = { name, input_schema_version: 1 as const, output_schema_version: 1 as const, input: z.toJSONSchema(input, { io: "input" }), output: z.toJSONSchema(output, { io: "output" }) };
  const hash = createHash("sha256").update(canonicalContractJson(contract)).digest("hex");
  return { contract, requirements: name === "runtime-delegation.create" ? [...delegationSchemaRequirements, dreamUnifiedSchemaRequirement] : delegationSchemaRequirements, capability: { name, method, path, input_schema_version: 1 as const, output_schema_version: 1 as const, contract_sha256: hash } };
}
export const delegationContracts = [
  descriptor("runtime-delegation.create", "POST", "/api/internal/dream/v1/runtime-delegations", delegationCreateInputDto, delegationOutputDto),
  descriptor("runtime-delegation.renew", "POST", "/api/runtime-delegations/renew", delegationActionRequestDto, delegationRenewOutputDto),
  descriptor("runtime-delegation.revoke", "POST", "/api/runtime-delegations/revoke", delegationActionRequestDto, delegationRevokeOutputDto),
  descriptor("runtime-delegation.receipt", "GET", "/api/runtime-delegations/receipts/{request_id}", delegationReceiptInputDto, z.union([delegationReceiptOutputDto("runtime-delegation.renew"), delegationReceiptOutputDto("runtime-delegation.revoke")])),
] as const;
export const delegationDiscoverySchemaRequirements = [...delegationSchemaRequirements, dreamUnifiedSchemaRequirement] as const;
