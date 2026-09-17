// [Input] Strict Notion operation, current OAuth/server-persistence actor or configured sync service, and Admin UOW.
// [Output] Owner-filtered connector DTO results with compound writes kept inside the caller transaction.
// [Pos] Notion data-domain service; Dream retains remote Notion, credentials, sync policy, Runtime and files.
// [Sync] 2026-09-16: expose complete Notion persistence through named DTO/ORM operations.
import { AuthBoundaryError, type DreamServiceClient } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import { requireBackgroundScope } from "../auth/serviceIdentity";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import * as dto from "./notionConnectorDto";
import { NotionConnectorRepository } from "./notionConnectorRepository";

export const notionConnectorSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

export type NotionConnectorActor = {
  principal: PrincipalDto;
  threadScope: string | null;
  runScope: string | null;
  delegationPurpose: "server-persistence" | null;
};
export type NotionSyncService = Pick<DreamServiceClient, "id"> & { backgroundScopes: readonly string[] };

function requireActor(rawActor: NotionConnectorActor, authority: dto.NotionAuthority, scope: string) {
  const principal = principalDto.safeParse(rawActor.principal);
  if (!principal.success || !principal.data.scopes.includes(scope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (rawActor.threadScope === null) {
    if (rawActor.runScope !== null || rawActor.delegationPurpose !== null || authority !== null) {
      throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    }
  } else if (
    rawActor.delegationPurpose !== "server-persistence"
    || authority === null
    || authority.thread_id !== rawActor.threadScope
    || authority.workflow_run_id !== rawActor.runScope
  ) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
  return principal.data;
}

export async function runNotionConnectorUserOperation(
  name: dto.NotionConnectorUserOperation,
  rawInput: unknown,
  actor: NotionConnectorActor,
  tx: DataTransaction,
) {
  const operation = dto.notionConnectorOperationContracts[name];
  if (!operation || operation.audience !== "user") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = operation.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data;
  const principal = requireActor(actor, input.authority, operation.userScope);
  const store = new NotionConnectorRepository(tx, principal.canonical_user_id);
  let result: unknown;
  switch (name) {
    case "notion.connector.create": {
      const value = dto.notionConnectorCreateInputDto.parse(input);
      result = { connector: await store.create(value.name, value.platform, value.config) };
      break;
    }
    case "notion.connector.list":
      result = { connectors: await store.list() };
      break;
    case "notion.connector.get": {
      const value = dto.notionConnectorGetInputDto.parse(input);
      result = { connector: await store.connector(value.connector_id) };
      break;
    }
    case "notion.connector.active":
      result = { connector: await store.active() };
      break;
    case "notion.connector.patch": {
      const value = dto.notionConnectorPatchInputDto.parse(input);
      result = { connector: await store.patch(value.connector_id, value.patch) };
      break;
    }
    case "notion.connector.delete": {
      const value = dto.notionConnectorDeleteInputDto.parse(input);
      result = { deleted: await store.delete(value.connector_id) };
      break;
    }
    case "notion.auth-state.save": {
      const value = dto.notionAuthStateSaveInputDto.parse(input);
      result = { connector: await store.patch(value.connector_id, {
        auth_status: value.auth_status, config_patch: value.config_patch,
      }) };
      break;
    }
    case "notion.resources.replace": {
      const value = dto.notionResourcesReplaceInputDto.parse(input);
      result = { connector: await store.replaceResources(value.connector_id, value.databases, value.pages) };
      break;
    }
    case "notion.resources.list": {
      const value = dto.notionResourcesListInputDto.parse(input);
      await store.requireConnector(value.connector_id);
      result = { resources: await store.listResources(value.connector_id) };
      break;
    }
    case "notion.resource.delete": {
      const value = dto.notionResourceDeleteInputDto.parse(input);
      result = { deleted: await store.deleteResource(value.connector_id, value.resource_id) };
      break;
    }
    case "notion.snapshot.save": {
      const value = dto.notionSnapshotSaveInputDto.parse(input);
      result = { snapshot: await store.saveSnapshot(value) };
      break;
    }
    case "notion.snapshot.current": {
      const value = dto.notionSnapshotCurrentInputDto.parse(input);
      result = { snapshot: await store.snapshot(value.connector_id, null) };
      break;
    }
    case "notion.snapshot.get": {
      const value = dto.notionSnapshotGetInputDto.parse(input);
      result = { snapshot: await store.snapshot(value.connector_id, value.snapshot_version) };
      break;
    }
    case "notion.snapshot.list": {
      const value = dto.notionSnapshotListInputDto.parse(input);
      result = { snapshots: await store.listSnapshots(value.connector_id) };
      break;
    }
    case "notion.thread.attach": {
      const value = dto.notionThreadAttachInputDto.parse(input);
      result = { connector: await store.attachThread(value.connector_id, value.thread_id) };
      break;
    }
    case "notion.thread.resolve": {
      const value = dto.notionThreadResolveInputDto.parse(input);
      result = { connector: await store.connectorForThread(value.thread_id) };
      break;
    }
    default:
      throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  }
  return operation.output.parse(result);
}

export function notionBackgroundReceiptActor(connectorId: string) {
  return `notion-sync:${dto.notionSyncConnectorInputDto.shape.connector_id.parse(connectorId)}`;
}

export async function runNotionConnectorBackgroundOperation(
  name: dto.NotionConnectorBackgroundOperation,
  rawInput: unknown,
  service: NotionSyncService,
  tx: DataTransaction,
) {
  if (!service.backgroundScopes.includes("connectors:sync")) {
    throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  }
  const operation = dto.notionConnectorOperationContracts[name];
  if (!operation || operation.audience !== "background") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = operation.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const store = new NotionConnectorRepository(tx, null);
  let result: unknown;
  switch (name) {
    case "notion.sync-candidates.list":
      result = { connectors: await store.syncCandidates() };
      break;
    case "notion.sync-connector.get": {
      const value = dto.notionSyncConnectorInputDto.parse(parsed.data);
      result = { connector: await store.connector(value.connector_id, { background: true }) };
      break;
    }
    case "notion.sync-connector.patch": {
      const value = dto.notionSyncConnectorPatchInputDto.parse(parsed.data);
      result = { connector: await store.patch(value.connector_id, value.patch, true) };
      break;
    }
    case "notion.sync-resources.list": {
      const value = dto.notionSyncResourcesInputDto.parse(parsed.data);
      await store.requireConnector(value.connector_id, { background: true });
      result = { resources: await store.listResources(value.connector_id) };
      break;
    }
    case "notion.sync-snapshot.save": {
      const value = dto.notionSyncSnapshotSaveInputDto.parse(parsed.data);
      result = { snapshot: await store.saveSnapshot(value, true) };
      break;
    }
    default:
      throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  }
  return operation.output.parse(result);
}
