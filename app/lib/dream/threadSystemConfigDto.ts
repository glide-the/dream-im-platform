// [Input] Existing closed owned-Thread selector and strict raw SystemConfig result.
// [Output] Unregistered Thread read descriptor; no actor/Run/key/path selector or write.
// [Pos] Reuses canonical ChatThread and UserConfig DTOs without new policy/configuration.
// [Sync] 2026-09-15: keep entity-bound Runtime config read separate from OAuth user management.
import { threadIdInputDto } from "./chatThreadDto";
import { userSystemConfigReadOutputDto } from "./userSystemConfigDto";
export const threadSystemConfigReadInputDto = threadIdInputDto;
export const threadSystemConfigReadOutputDto = userSystemConfigReadOutputDto;
export const threadSystemConfigOperationContracts = {
  "thread-system-config.get": { kind: "read" as const, input: threadSystemConfigReadInputDto, output: threadSystemConfigReadOutputDto, userScope: "dream:read" },
};
export type ThreadSystemConfigOperation = keyof typeof threadSystemConfigOperationContracts;
