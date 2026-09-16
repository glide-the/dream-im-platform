// [Input] Frozen additive identity/receipt schema descriptor produced by Admin Drizzle.
// [Output] Exact version/hash requirement for shared identity and receipt consumers.
// [Pos] Physical capability reference; no global-head coupling or runtime DDL.
// [Sync] 2026-09-16: expose the additive Runtime Reflections-authority binding capability.
// [Sync] 2026-09-16: expose the additive Runtime confirmation-claim binding capability.
import identityContract from "../../../drizzle/contracts/identity-better-auth-v1.json";
import runtimeContract from "../../../drizzle/contracts/identity-runtime-delegation-v1.json";
import purposeContract from "../../../drizzle/contracts/identity-runtime-purpose-v1.json";
import deckCanonicalContract from "../../../drizzle/contracts/dream-deck-content-canonical-storage-v1.json";
import preflightRequestContract from "../../../drizzle/contracts/dream-workflow-preflight-request-v1.json";
import reflectionTaskContract from "../../../drizzle/contracts/dream-reflection-task-persistence-v1.json";
import runtimeConfirmationClaimContract from "../../../drizzle/contracts/identity-runtime-confirmation-claim-v1.json";
import runtimeReflectionAuthorityContract from "../../../drizzle/contracts/identity-runtime-reflection-authority-v1.json";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
export const identitySchemaRequirement = { capability: "identity.better-auth.v1", version: 1, contractSha256: identityContract.contract_sha256 } as const;
export const runtimeDelegationSchemaRequirement = { capability: "identity.runtime-delegation.v1", version: 1, contractSha256: runtimeContract.contract_sha256 } as const;
export const runtimePurposeSchemaRequirement = { capability: "identity.runtime-purpose.v1", version: 1, contractSha256: purposeContract.contract_sha256 } as const;
export const runtimeConfirmationClaimSchemaRequirement = { capability: "identity.runtime-confirmation-claim.v1", version: 1, contractSha256: runtimeConfirmationClaimContract.contract_sha256 } as const;
export const runtimeReflectionAuthoritySchemaRequirement = { capability: "identity.runtime-reflection-authority.v1", version: 1, contractSha256: runtimeReflectionAuthorityContract.contract_sha256 } as const;
export const deckContentCanonicalSchemaRequirement = { capability: "dream.deck-content-canonical-storage.v1", version: 1, contractSha256: deckCanonicalContract.contract_sha256 } as const;
export const workflowPreflightRequestSchemaRequirement = { capability: "dream.workflow-preflight-request.v1", version: 1, contractSha256: preflightRequestContract.contract_sha256 } as const;
export const workflowPreflightExecutionSchemaRequirements = [identitySchemaRequirement, dreamUnifiedSchemaRequirement, workflowPreflightRequestSchemaRequirement] as const;
export const reflectionTaskSchemaRequirement = { capability: "dream.reflection-task-persistence.v1", version: 1, contractSha256: reflectionTaskContract.contract_sha256 } as const;
export const reflectionTaskSchemaRequirements = [dreamUnifiedSchemaRequirement, reflectionTaskSchemaRequirement] as const;
