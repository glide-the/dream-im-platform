// [Input] Registry198 prefix, new task-result DTOs and exact physical capability.
// [Output] Append-only operation identities and rejected actor/session/settlement overrides.
// [Pos] Provider-free contract gate for Dream task-result integration.
// [Sync] 2026-09-28: preserve the task-result registry slice after scheduled Chat operations append.
// [Sync] 2026-09-27: register returning create, four result operations and service-only recovery claim.
import { expect, it } from "vitest";
import generated from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { dreamOperations } from "./operationRegistry";
import { chatTaskResultSchemaRequirement, chatTaskSessionSchemaRequirement } from "./chatThreadService";
import { resultClaimInputDto, resultCommitInputDto, resultSettleInputDto } from "./taskSessionResultDto";

it("appends exactly the task-result operations after Registry198", () => {
  expect(generated).toEqual(dreamOperations);
  expect(dreamOperations.length).toBeGreaterThanOrEqual(204);
  const added = dreamOperations.slice(198, 204);
  expect(added.map(item => item.contract.name)).toEqual([
    "task-session.create-returning", "task-session.result-commit", "task-session.result-list",
    "task-session.result-claim", "task-session.result-settle", "task-session.result-claim-next",
  ]);
  expect(added.map(item => item.capability.contract_sha256)).toEqual([
    "1bfce994c2c010b1fc0502c83622a261ef822c33662de32db983cc2b7b3564cf",
    "eb39e34ca35c9d28719768dc72b70ab7b4f83b2d6ebf34dcfbb347ce67a07e24",
    "edbe99f6b6001d8f3684eb8b6881a567bc1b14ef9ae406c5830d61a0bd171f4a",
    "0da2e968d8b58634ee51dda2f11c14c596ca496a88e72d64dff9bb34cd3fc00d",
    "9245077bb8d71ba7212eb47b4850e98d3a89a1dc0850466ead4aee2db99f8d4e",
    "8d5758403ddd14c90568a4b2e06d14d68150822d6cf675967b5218907d3fd732",
  ]);
  expect(added.every(item => item.requirements.some(required => required.capability === chatTaskResultSchemaRequirement.capability))).toBe(true);
  expect(added.every(item => item.requirements.some(required => required.capability === chatTaskSessionSchemaRequirement.capability))).toBe(true);
  expect(added.slice(3).map(item => item.capability.background_scope)).toEqual(["task-return:dispatch", "task-return:dispatch", "task-return:dispatch"]);
  expect(added.slice(3).map(item => item.capability.user_scope)).toEqual([null, null, null]);
});

it("allows only server-derived task and source identity", () => {
  const commit = { target_thread_id: "target", target_turn_id: "turn", target_final_message_id: "message" };
  expect(resultCommitInputDto.safeParse(commit).success).toBe(true);
  expect(resultCommitInputDto.safeParse({ ...commit, task_id: "model-supplied" }).success).toBe(false);
  const claim = { notification_id: "notice", expected_revision: 1, source_turn_id: "turn" };
  expect(resultClaimInputDto.safeParse(claim).success).toBe(true);
  expect(resultClaimInputDto.safeParse({ ...claim, claude_session_id: "forged" }).success).toBe(false);
  expect(resultSettleInputDto.safeParse({ notification_id: "notice", expected_revision: 2, claim_id: "claim", action: "delivered" }).success).toBe(true);
  expect(resultSettleInputDto.safeParse({ notification_id: "notice", expected_revision: 2, claim_id: "claim", action: "delivered", source_final_message_id: "forged" }).success).toBe(false);
});
