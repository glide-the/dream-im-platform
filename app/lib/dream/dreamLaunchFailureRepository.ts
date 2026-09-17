// [Input] Existing typed caller UOW and canonical owned Run/workspace/source.
// [Output] Locked owner-scoped facts and one narrow message metadata update.
// [Pos] Registered77 failure repository reusing existing workspace/Run/source queries.
// [Sync] 2026-09-15: preserve workspace SHARE/Run UPDATE/backing message-Thread locking at registration.
import type { DataTransaction } from "./database";
import { WorkflowRunCreationRepository } from "./workflowRunCreationRepository";
import { DreamLaunchDispatchRepository } from "./dreamLaunchDispatchRepository";
export class DreamLaunchFailureRepository {
  private readonly backing: DreamLaunchDispatchRepository;
  constructor(private readonly tx: DataTransaction) { this.backing = new DreamLaunchDispatchRepository(tx); }
  ownedWorkspace(actor: string, runId: string) { return this.backing.ownedWorkspace(actor, runId); }
  async ownedRun(actor: string, input: { workspace_id: string; workflow_run_id: string }) {
    await new WorkflowRunCreationRepository(this.tx, actor, input.workspace_id).assertWorkspace();
    return this.backing.run(actor, input.workspace_id, input.workflow_run_id, true);
  }
  source(messageId: string, threadId: string) { return this.backing.source(messageId, threadId); }
  update(messageId: string, threadId: string, metadata: string) { return this.backing.finish(messageId, threadId, metadata); }
}
