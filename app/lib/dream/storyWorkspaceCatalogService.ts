// [Input] Strict Registry114 catalog command, OAuth principal, request identity, and Admin transaction.
// [Output] Owner-scoped DTO/ORM read or idempotent audited mutation with one transaction boundary.
// [Pos] Story Workspace catalog service; Dream keeps routes/pages/Runtime/SSE/files while Admin owns persistence.
// [Sync] 2026-09-15: implement catalog browse, default Workspace, and controlled edit operations.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { WorkspaceDefaultRepository } from "./workspaceDefaultRepository";
import { StoryWorkspaceCatalogRepository } from "./storyWorkspaceCatalogRepository";
import * as dto from "./storyWorkspaceCatalogDto";

export const storyWorkspaceCatalogSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

function requireNonemptyPatch(patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) throw new AuthBoundaryError("INPUT_INVALID", 400);
}

export async function runStoryWorkspaceCatalogOperation(
  operation: dto.StoryWorkspaceCatalogOperation,
  rawInput: unknown,
  rawPrincipal: unknown,
  serviceId: string,
  requestId: string,
  tx: DataTransaction,
) {
  const principal = principalDto.parse(rawPrincipal);
  const contract = dto.storyWorkspaceCatalogOperationContracts[operation];
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new StoryWorkspaceCatalogRepository(tx, principal.canonical_user_id);
  if (operation === "story-workspace-catalog.read") {
    return dto.storyWorkspaceCatalogReadResultDto.parse(await store.read(
      parsed.data as dto.StoryWorkspaceCatalogReadInput,
    ));
  }
  const receipts = new ReceiptRepository(tx, serviceId, principal.subject);
  if (operation === "story-workspace-catalog.workspace") {
    const input = parsed.data as dto.StoryWorkspaceCatalogWorkspaceInput;
    if (input.action === "patch") requireNonemptyPatch(input.patch);
    return receipts.execute(operation, requestId, input, dto.storyWorkspaceCatalogWorkspaceResultDto, async () => {
      let item;
      if (input.action === "ensure") {
        const defaults = new WorkspaceDefaultRepository(tx, principal.canonical_user_id);
        await defaults.lockActor();
        const current = await defaults.oldestOwned();
        const id = current?.id ?? randomUUID();
        if (!current) await defaults.insert(id);
        item = await store.workspace(id);
        await store.audit(requestId, "dream.story-workspace-catalog.ensure", "story_workspace_workspace", id);
      } else {
        item = await store.patchWorkspace(input.workspace_id, input.patch);
        await store.audit(requestId, "dream.story-workspace-catalog.patch", "story_workspace_workspace", input.workspace_id);
      }
      return { action: input.action, item };
    });
  }
  if (operation === "story-workspace-catalog.patch") {
    const input = parsed.data as dto.StoryWorkspaceCatalogPatchInput;
    requireNonemptyPatch(input.patch);
    return receipts.execute(operation, requestId, input, dto.storyWorkspaceCatalogPatchResultDto, async () => {
      const result = await store.patch(input);
      await store.audit(requestId, "dream.story-workspace-catalog.patch",
        `story_workspace_${input.resource_type}`, input.resource_id);
      return dto.storyWorkspaceCatalogPatchResultDto.parse(result);
    });
  }
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
}
