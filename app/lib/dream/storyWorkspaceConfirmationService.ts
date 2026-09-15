// [Input] Verified OAuth principal or exact scoped background service and Registry120 command.
// [Output] Durable confirmation submit/fact/claim/lease/ack through one caller-owned Admin UOW.
// [Pos] DTO-Service-Drizzle composition; Dream retains filesystem validation, Runtime, EventBus and SSE.
// [Sync] 2026-09-16: implement the complete confirmation persistence and delivery claim state machine.
import { createHash, randomUUID } from "node:crypto";
import { AuthBoundaryError, requiredAuthValue, type DreamServiceClient } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import { canonicalContractJson } from "./canonicalContractJson";
import { buildConfirmationEnvelope, analyzeConfirmationEnvelope } from "./deckContentCanonical";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { StoryWorkspaceConfirmationRepository, type StoryWorkspaceConfirmationMessageRow } from "./storyWorkspaceConfirmationRepository";
import * as dto from "./storyWorkspaceConfirmationDto";

export const storyWorkspaceConfirmationSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type StoryWorkspaceConfirmationExecutionService = Pick<DreamServiceClient, "id"> & { backgroundScopes: readonly string[] };
const confirmationKind = "story-workspace-dream-confirmation";
const lifecycle = [
  ["running", "output_validating", "dream_required_stages_present"],
  ["output_validating", "pending_review", "dream_output_contract_valid"],
  ["pending_review", "confirmed", "dream_confirmation_accepted"],
] as const;

export function configuredStoryWorkspaceConfirmationLeaseSeconds() {
  const seconds = Number(requiredAuthValue("DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS"));
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new AuthBoundaryError("DREAM_CONFIRMATION_POLICY_INVALID");
  return seconds;
}
function requireBackgroundScope(service: StoryWorkspaceConfirmationExecutionService) {
  if (!service.backgroundScopes.includes("story-confirmation:dispatch")) {
    throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  }
}
function parseMetadata(raw: string | null) {
  if (raw === null) return null;
  try {
    const parsed = dto.storyWorkspaceConfirmationMetadataDto.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
async function decodeRow(row: NonNullable<StoryWorkspaceConfirmationMessageRow>) {
  const metadata = parseMetadata(row.metadata_json);
  if (!metadata || row.role !== "user" || row.actor_id !== metadata.actor || row.thread_id !== metadata.thread_id) return null;
  const envelope = await analyzeConfirmationEnvelope(row.parts_json, row.actor_id);
  if (envelope.status !== "valid" || envelope.message_id !== row.id
    || envelope.story_workspace_run_id !== metadata.story_workspace_run_id
    || envelope.thread_id !== row.thread_id || envelope.idempotency_key !== metadata.idempotency_key
    || envelope.command_fingerprint !== metadata.command_fingerprint
    || envelope.parts_canonical_json !== row.parts_json) return null;
  const dispatch = dto.storyWorkspaceConfirmationDispatchDto.safeParse({
    thread_id: row.thread_id, actor_id: row.actor_id, message_id: row.id,
    parts_json: row.parts_json, metadata_json: row.metadata_json,
  });
  if (!dispatch.success) return null;
  return { metadata, envelope, dispatch: dispatch.data };
}
function ackHash(claimId: string) {
  return `sha256:${createHash("sha256").update(canonicalContractJson(claimId)).digest("hex")}`;
}
async function advanceToConfirmed(
  store: StoryWorkspaceConfirmationRepository,
  rawRun: { workflow_run_id: string; status: string; status_version: number },
  actor: string,
) {
  let run = rawRun;
  if (["confirmed", "completed"].includes(run.status)) return run;
  for (const [from, target, reason] of lifecycle) {
    if (run.status !== from) continue;
    const occurredAt = await store.clockText();
    const next = await store.advanceRun(run, target, actor, reason,
      `wrt_${randomUUID().replaceAll("-", "")}`, occurredAt);
    if (!next) throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
    run = next;
  }
  if (run.status !== "confirmed" && run.status !== "completed") {
    throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
  }
  return run;
}
async function prepareSubmission(raw: unknown, principal: PrincipalDto) {
  const input = dto.storyWorkspaceConfirmationSubmitInputDto.safeParse(raw);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const built = await buildConfirmationEnvelope(input.data.command_json, principal.canonical_user_id);
  if (built.status !== "valid") throw new AuthBoundaryError("INPUT_INVALID", 400);
  let command: unknown;
  try { command = JSON.parse(built.command_json); } catch { throw new AuthBoundaryError("INPUT_INVALID", 400); }
  const parsed = dto.storyWorkspaceConfirmationCommandDto.safeParse(command);
  if (!parsed.success || built.story_workspace_run_id !== parsed.data.storyWorkspaceRunId
    || built.thread_id !== parsed.data.threadId || built.idempotency_key !== parsed.data.idempotencyKey) {
    throw new AuthBoundaryError("INPUT_INVALID", 400);
  }
  return { input: input.data, command: parsed.data, built };
}
function metadataForNew(
  actor: string,
  command: dto.StoryWorkspaceConfirmationCommand,
  fingerprint: string,
  requestId: string,
): dto.StoryWorkspaceConfirmationMetadata {
  return dto.storyWorkspaceConfirmationMetadataDto.parse({
    kind: confirmationKind,
    actor,
    story_workspace_run_id: command.storyWorkspaceRunId,
    thread_id: command.threadId,
    base_revisions: command.baseRevisions,
    edit_count: command.edits.length,
    command_fingerprint: fingerprint,
    idempotency_key: command.idempotencyKey,
    request_id: requestId,
    dispatch_status: "pending",
  });
}
function submitResult(
  decoded: NonNullable<Awaited<ReturnType<typeof decodeRow>>>,
  replayed: boolean,
) {
  const status = decoded.metadata.dispatch_status;
  return dto.storyWorkspaceConfirmationSubmitOutputDto.parse({
    message_id: decoded.dispatch.message_id,
    story_workspace_run_id: decoded.metadata.story_workspace_run_id,
    thread_id: decoded.dispatch.thread_id,
    status: "accepted",
    replayed,
    dispatched: status === "dispatched",
    request_id: decoded.metadata.request_id,
    // Only the transaction that creates the durable row may request an
    // immediate Dream schedule. Replays rely on the Admin claim reconciler so
    // concurrent HTTP responses cannot inject the same Runtime turn twice.
    dispatch: status === "pending" && !replayed ? decoded.dispatch : null,
  });
}

export function runStoryWorkspaceConfirmationOAuthOperation(
  name: "story-workspace-confirmation.submit", rawInput: unknown, rawPrincipal: unknown,
  serviceId: string, requestId: string, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationSubmitOutput>;
export function runStoryWorkspaceConfirmationOAuthOperation(
  name: "story-workspace-confirmation.fact", rawInput: unknown, rawPrincipal: unknown,
  serviceId: string, requestId: string, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationFactOutput>;
export function runStoryWorkspaceConfirmationOAuthOperation(
  name: dto.StoryWorkspaceConfirmationOAuthOperation, rawInput: unknown, rawPrincipal: unknown,
  serviceId: string, requestId: string, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationSubmitOutput | dto.StoryWorkspaceConfirmationFactOutput>;
export async function runStoryWorkspaceConfirmationOAuthOperation(
  name: dto.StoryWorkspaceConfirmationOAuthOperation,
  rawInput: unknown,
  rawPrincipal: unknown,
  serviceId: string,
  requestId: string,
  tx: DataTransaction,
) {
  const principal = principalDto.parse(rawPrincipal);
  const contract = dto.storyWorkspaceConfirmationOperationContracts[name];
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new StoryWorkspaceConfirmationRepository(tx);
  if (name === "story-workspace-confirmation.fact") {
    const parsed = dto.storyWorkspaceConfirmationFactInputDto.safeParse(rawInput);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    const run = await store.ownedRun(principal.canonical_user_id, parsed.data.workflow_run_id, false);
    if (!run || run.source_voice_thread_id === null) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
    let accepted = false, dispatched = false;
    for (const row of await store.threadConfirmationRows(run.source_voice_thread_id)) {
      const decoded = await decodeRow(row);
      if (!decoded || decoded.metadata.actor !== principal.canonical_user_id
        || decoded.metadata.story_workspace_run_id !== parsed.data.workflow_run_id) continue;
      accepted = true;
      dispatched ||= decoded.metadata.dispatch_status === "dispatched";
    }
    return dto.storyWorkspaceConfirmationFactOutputDto.parse({
      workflow_run_id: parsed.data.workflow_run_id,
      thread_id: run.source_voice_thread_id,
      confirmation_accepted: accepted,
      confirmation_dispatched: dispatched,
    });
  }

  const prepared = await prepareSubmission(rawInput, principal);
  const run = await store.ownedRun(principal.canonical_user_id, prepared.command.storyWorkspaceRunId);
  if (!run) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  if (run.source_voice_thread_id !== prepared.command.threadId) throw new AuthBoundaryError("CONFIG_VERSION_DRIFT", 409);
  return new ReceiptRepository(tx, serviceId, principal.subject).execute(
    name, requestId, prepared.input, dto.storyWorkspaceConfirmationSubmitOutputDto,
    async () => {
      await store.lockMessageIdentity(prepared.built.message_id);
      const existing = await store.message(prepared.built.message_id);
      if (existing) {
        const decoded = await decodeRow(existing);
        if (!decoded || decoded.metadata.actor !== principal.canonical_user_id
          || decoded.metadata.story_workspace_run_id !== prepared.command.storyWorkspaceRunId
          || decoded.metadata.command_fingerprint !== prepared.built.command_fingerprint) {
          throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
        }
        return submitResult(decoded, true);
      }
      for (const row of await store.threadConfirmationRows(prepared.command.threadId)) {
        const decoded = await decodeRow(row);
        if (decoded?.metadata.actor === principal.canonical_user_id
          && decoded.metadata.story_workspace_run_id === prepared.command.storyWorkspaceRunId) {
          throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
        }
      }
      const metadataJson = canonicalContractJson(metadataForNew(
        principal.canonical_user_id, prepared.command, prepared.built.command_fingerprint, requestId,
      ));
      if (!await store.insertMessage(prepared.built.message_id, prepared.command.threadId,
        prepared.built.parts_canonical_json, metadataJson, principal.canonical_user_id)) {
        throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
      }
      await advanceToConfirmed(store, run, principal.canonical_user_id);
      const inserted = await store.message(prepared.built.message_id);
      const decoded = inserted ? await decodeRow(inserted) : null;
      if (!decoded) throw new AuthBoundaryError("RESULT_COMMIT_FAILED", 503);
      return submitResult(decoded, false);
    },
    prepared.command.threadId,
    null,
    prepared.command.storyWorkspaceRunId,
  );
}

async function claimExisting(
  store: StoryWorkspaceConfirmationRepository,
  row: NonNullable<StoryWorkspaceConfirmationMessageRow>,
  claimId: string,
  leaseSeconds: number,
) {
  await store.lockMessageIdentity(row.id);
  const currentRow = await store.message(row.id);
  const decoded = currentRow ? await decodeRow(currentRow) : null;
  if (!currentRow || !decoded || currentRow.metadata_json === null) return null;
  const run = await store.scopedRun(decoded.metadata.actor, decoded.metadata.story_workspace_run_id, decoded.dispatch.thread_id);
  if (!run) return null;
  const now = await store.clockSeconds();
  if (!Number.isFinite(now) || now < 0) throw new AuthBoundaryError("DREAM_CONFIRMATION_POLICY_INVALID");
  const sameClaim = decoded.metadata.dispatch_status === "dispatching"
    && decoded.metadata.dispatch_claim_id === claimId;
  const eligible = decoded.metadata.dispatch_status === "pending" || sameClaim
    || (decoded.metadata.dispatch_status === "dispatching"
      && typeof decoded.metadata.dispatch_claim_lease_until === "number"
      && decoded.metadata.dispatch_claim_lease_until <= now);
  if (!eligible) return null;
  await advanceToConfirmed(store, run, decoded.metadata.actor);
  const refreshed = await buildConfirmationEnvelope(decoded.envelope.command_json, decoded.metadata.actor);
  if (refreshed.status !== "valid" || refreshed.message_id !== currentRow.id
    || refreshed.command_fingerprint !== decoded.metadata.command_fingerprint) return null;
  const claimBase: Partial<dto.StoryWorkspaceConfirmationMetadata> = { ...decoded.metadata };
  delete claimBase.dispatch_ack_claim_sha256;
  const metadata = dto.storyWorkspaceConfirmationMetadataDto.parse({
    ...claimBase,
    dispatch_status: "dispatching",
    dispatch_claim_id: claimId,
    dispatch_claim_lease_until: now + leaseSeconds,
  });
  const metadataJson = canonicalContractJson(metadata);
  if (!await store.compareAndSetMessage(currentRow.id, currentRow.parts_json, currentRow.metadata_json,
    refreshed.parts_canonical_json, metadataJson)) return null;
  return dto.storyWorkspaceConfirmationDispatchDto.parse({
    thread_id: currentRow.thread_id,
    actor_id: decoded.metadata.actor,
    message_id: currentRow.id,
    parts_json: refreshed.parts_canonical_json,
    metadata_json: metadataJson,
  });
}

export function runStoryWorkspaceConfirmationBackgroundOperation(
  name: "story-workspace-confirmation.claim", rawInput: unknown,
  service: StoryWorkspaceConfirmationExecutionService, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationClaimOutput>;
export function runStoryWorkspaceConfirmationBackgroundOperation(
  name: "story-workspace-confirmation.lease", rawInput: unknown,
  service: StoryWorkspaceConfirmationExecutionService, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationLeaseOutput>;
export function runStoryWorkspaceConfirmationBackgroundOperation(
  name: "story-workspace-confirmation.ack", rawInput: unknown,
  service: StoryWorkspaceConfirmationExecutionService, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationAckOutput>;
export function runStoryWorkspaceConfirmationBackgroundOperation(
  name: dto.StoryWorkspaceConfirmationBackgroundOperation, rawInput: unknown,
  service: StoryWorkspaceConfirmationExecutionService, tx: DataTransaction,
): Promise<dto.StoryWorkspaceConfirmationClaimOutput | dto.StoryWorkspaceConfirmationLeaseOutput | dto.StoryWorkspaceConfirmationAckOutput>;
export async function runStoryWorkspaceConfirmationBackgroundOperation(
  name: dto.StoryWorkspaceConfirmationBackgroundOperation,
  rawInput: unknown,
  service: StoryWorkspaceConfirmationExecutionService,
  tx: DataTransaction,
) {
  requireBackgroundScope(service);
  const contract = dto.storyWorkspaceConfirmationOperationContracts[name];
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const store = new StoryWorkspaceConfirmationRepository(tx);
  const leaseSeconds = configuredStoryWorkspaceConfirmationLeaseSeconds();
  if (name === "story-workspace-confirmation.claim") {
    const input = dto.storyWorkspaceConfirmationClaimInputDto.parse(parsed.data);
    const rows = await store.pendingCandidates(input.message_id);
    const sameClaim = [] as typeof rows;
    const other = [] as typeof rows;
    for (const row of rows) {
      const metadata = parseMetadata(row.metadata_json);
      (metadata?.dispatch_status === "dispatching" && metadata.dispatch_claim_id === input.claim_id
        ? sameClaim : other).push(row);
    }
    for (const row of [...sameClaim, ...other]) {
      const dispatch = await claimExisting(store, row, input.claim_id, leaseSeconds);
      if (dispatch) return dto.storyWorkspaceConfirmationClaimOutputDto.parse({ dispatch });
    }
    return dto.storyWorkspaceConfirmationClaimOutputDto.parse({ dispatch: null });
  }

  const identity = name === "story-workspace-confirmation.lease"
    ? dto.storyWorkspaceConfirmationLeaseInputDto.parse(parsed.data)
    : dto.storyWorkspaceConfirmationAckInputDto.parse(parsed.data);
  await store.lockMessageIdentity(identity.message_id);
  const row = await store.message(identity.message_id);
  const decoded = row ? await decodeRow(row) : null;
  if (!row || !decoded || row.metadata_json === null) {
    if (name === "story-workspace-confirmation.ack") throw new AuthBoundaryError("RESULT_COMMIT_FAILED", 503);
    return dto.storyWorkspaceConfirmationLeaseOutputDto.parse({ renewed: false, lease_until: null });
  }
  if (name === "story-workspace-confirmation.lease") {
    const input = dto.storyWorkspaceConfirmationLeaseInputDto.parse(parsed.data);
    if (decoded.metadata.dispatch_status !== "dispatching"
      || decoded.metadata.dispatch_claim_id !== input.claim_id) {
      return dto.storyWorkspaceConfirmationLeaseOutputDto.parse({ renewed: false, lease_until: null });
    }
    const now = await store.clockSeconds();
    if (input.duration_seconds !== null && input.duration_seconds > leaseSeconds) {
      throw new AuthBoundaryError("INPUT_INVALID", 400);
    }
    const leaseUntil = now + (input.duration_seconds ?? leaseSeconds);
    const metadataJson = canonicalContractJson(dto.storyWorkspaceConfirmationMetadataDto.parse({
      ...decoded.metadata, dispatch_claim_lease_until: leaseUntil,
    }));
    const renewed = await store.compareAndSetMetadata(row.id, row.metadata_json, metadataJson);
    return dto.storyWorkspaceConfirmationLeaseOutputDto.parse({
      renewed,
      lease_until: renewed ? leaseUntil : null,
    });
  }

  const expectedHash = ackHash(identity.claim_id);
  if (decoded.metadata.dispatch_status === "dispatched") {
    if (decoded.metadata.dispatch_ack_claim_sha256 !== expectedHash) {
      throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
    }
    return dto.storyWorkspaceConfirmationAckOutputDto.parse({ acked: true });
  }
  if (decoded.metadata.dispatch_status !== "dispatching"
    || decoded.metadata.dispatch_claim_id !== identity.claim_id) {
    throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
  }
  const run = await store.scopedRun(decoded.metadata.actor, decoded.metadata.story_workspace_run_id, decoded.dispatch.thread_id);
  if (!run || !["confirmed", "completed"].includes(run.status)) {
    throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
  }
  const ackBase: Partial<dto.StoryWorkspaceConfirmationMetadata> = { ...decoded.metadata };
  delete ackBase.dispatch_claim_id;
  delete ackBase.dispatch_claim_lease_until;
  const metadataJson = canonicalContractJson(dto.storyWorkspaceConfirmationMetadataDto.parse({
    ...ackBase,
    dispatch_status: "dispatched",
    dispatch_ack_claim_sha256: expectedHash,
  }));
  if (!await store.compareAndSetMetadata(row.id, row.metadata_json, metadataJson)) {
    throw new AuthBoundaryError("RESULT_COMMIT_FAILED", 503);
  }
  return dto.storyWorkspaceConfirmationAckOutputDto.parse({ acked: true });
}
