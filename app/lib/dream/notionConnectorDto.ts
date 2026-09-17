// [Input] Actor-free Notion connector commands, canonical snapshot data and optional exact Runtime authority.
// [Output] Strict named DTOs for connector, resource, snapshot, thread binding and scheduled sync persistence.
// [Pos] Cross-project contract; user identity, SQL, transactions, Notion CLI and filesystem paths remain server-owned.
// [Sync] 2026-09-16: define the complete Notion connector data boundary before removing Dream PostgreSQL access.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { workflowRunIdDto } from "./workflowRunDto";

const identifier = z.string().trim().min(1).max(255);
const connectorId = z.uuid();
const decimalId = z.string().regex(/^[1-9][0-9]*$/);
const jsonObject = z.record(z.string(), z.json());

export const notionAuthorityDto = z.strictObject({
  thread_id: identifier,
  workflow_run_id: workflowRunIdDto.nullable(),
}).nullable();

const userInput = { authority: notionAuthorityDto };

export const notionResourceDto = z.strictObject({
  id: connectorId,
  connector_id: connectorId,
  resource_type: z.enum(["notion_database", "notion_page"]),
  external_id: identifier,
  title: z.string().max(2000),
  metadata: jsonObject,
  sync_status: z.string().min(1).max(64),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
});

export const notionConnectorDto = z.strictObject({
  id: connectorId,
  user_id: decimalId,
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(64),
  auth_status: z.string().trim().min(1).max(64),
  config: jsonObject,
  current_snapshot_version: identifier.nullable(),
  current_source_revision: identifier.nullable(),
  current_sync_cursor: identifier.nullable(),
  last_synced_at: isoTimeDto.nullable(),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  sources: z.array(notionResourceDto),
});

export const notionConnectorOutputDto = z.strictObject({ connector: notionConnectorDto });
export const notionConnectorNullableOutputDto = z.strictObject({ connector: notionConnectorDto.nullable() });
export const notionConnectorListOutputDto = z.strictObject({ connectors: z.array(notionConnectorDto) });

export const notionConnectorCreateInputDto = z.strictObject({
  ...userInput,
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(64),
  config: jsonObject,
});
export const notionConnectorListInputDto = z.strictObject(userInput);
export const notionConnectorGetInputDto = z.strictObject({ ...userInput, connector_id: connectorId });
export const notionConnectorActiveInputDto = z.strictObject(userInput);

export const notionConnectorPatchDto = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  platform: z.string().trim().min(1).max(64).optional(),
  auth_status: z.string().trim().min(1).max(64).optional(),
  config_patch: jsonObject.optional(),
  current_snapshot_version: identifier.nullable().optional(),
  current_source_revision: identifier.nullable().optional(),
  current_sync_cursor: identifier.nullable().optional(),
  last_synced_at: isoTimeDto.nullable().optional(),
}).refine(value => Object.keys(value).length > 0, "At least one connector field is required");

export const notionConnectorPatchInputDto = z.strictObject({
  ...userInput,
  connector_id: connectorId,
  patch: notionConnectorPatchDto,
});
export const notionConnectorDeleteInputDto = z.strictObject({ ...userInput, connector_id: connectorId });
export const notionConnectorDeleteOutputDto = z.strictObject({ deleted: z.boolean() });

export const notionAuthStateSaveInputDto = z.strictObject({
  ...userInput,
  connector_id: connectorId,
  auth_status: z.string().trim().min(1).max(64),
  config_patch: jsonObject,
});

export const notionResourceSelectionDto = z.strictObject({
  external_id: identifier,
  title: z.string().max(2000),
  metadata: jsonObject,
});
export const notionResourcesReplaceInputDto = z.strictObject({
  ...userInput,
  connector_id: connectorId,
  databases: z.array(notionResourceSelectionDto).max(10_000),
  pages: z.array(notionResourceSelectionDto).max(10_000),
});
export const notionResourcesListInputDto = z.strictObject({ ...userInput, connector_id: connectorId });
export const notionResourcesListOutputDto = z.strictObject({ resources: z.array(notionResourceDto) });
export const notionResourceDeleteInputDto = z.strictObject({
  ...userInput,
  connector_id: connectorId,
  resource_id: connectorId,
});
export const notionResourceDeleteOutputDto = z.strictObject({ deleted: z.boolean() });

export const notionSnapshotMetadataDto = z.strictObject({
  workspace_id: identifier,
  resource_connector_id: connectorId,
  snapshot_version: identifier,
  source_revision: identifier,
  sync_cursor: identifier,
  fetched_at: isoTimeDto,
  state: z.literal("snapshot_ready"),
});
export const notionSnapshotDto = jsonObject.superRefine((value, context) => {
  const parsed = notionSnapshotMetadataDto.safeParse(value.metadata);
  if (!parsed.success) context.addIssue({ code: "custom", message: "Canonical snapshot metadata is invalid" });
  for (const key of ["connector", "index", "databases", "database_pages", "pages"]) {
    if (!Object.hasOwn(value, key)) context.addIssue({ code: "custom", message: `Canonical snapshot is missing ${key}` });
  }
});
export const notionSyncedResourceDto = z.strictObject({
  resource_type: z.enum(["notion_database", "notion_page"]),
  external_id: identifier,
});
export const notionSnapshotSaveCoreDto = z.strictObject({
  connector_id: connectorId,
  workspace_id: identifier,
  snapshot: notionSnapshotDto,
  synced_resources: z.array(notionSyncedResourceDto).max(20_000),
});
export const notionSnapshotSaveInputDto = z.strictObject({
  ...userInput,
  ...notionSnapshotSaveCoreDto.shape,
});
export const notionSnapshotOutputDto = z.strictObject({ snapshot: notionSnapshotDto });
export const notionSnapshotNullableOutputDto = z.strictObject({ snapshot: notionSnapshotDto.nullable() });
export const notionSnapshotRecordDto = z.strictObject({
  id: connectorId,
  connector_id: connectorId,
  snapshot_version: identifier,
  source_revision: identifier,
  sync_cursor: identifier,
  fetched_at: isoTimeDto,
  state: z.literal("snapshot_ready"),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  snapshot: notionSnapshotDto,
});
export const notionSnapshotCurrentInputDto = z.strictObject({ ...userInput, connector_id: connectorId, workspace_id: identifier });
export const notionSnapshotGetInputDto = z.strictObject({ ...userInput, connector_id: connectorId, snapshot_version: identifier });
export const notionSnapshotListInputDto = z.strictObject({ ...userInput, connector_id: connectorId });
export const notionSnapshotListOutputDto = z.strictObject({ snapshots: z.array(notionSnapshotRecordDto) });

export const notionThreadAttachInputDto = z.strictObject({ ...userInput, connector_id: connectorId, thread_id: identifier });
export const notionThreadResolveInputDto = z.strictObject({ ...userInput, thread_id: identifier });

export const notionSyncCandidatesInputDto = z.strictObject({});
export const notionSyncCandidatesOutputDto = z.strictObject({ connectors: z.array(notionConnectorDto) });
export const notionSyncConnectorInputDto = z.strictObject({ connector_id: connectorId });
export const notionSyncConnectorPatchInputDto = z.strictObject({ connector_id: connectorId, patch: notionConnectorPatchDto });
export const notionSyncResourcesInputDto = z.strictObject({ connector_id: connectorId });
export const notionSyncSnapshotSaveInputDto = notionSnapshotSaveCoreDto;

const userRead = <Input extends z.ZodType, Output extends z.ZodType>(input: Input, output: Output) =>
  ({ kind: "read" as const, audience: "user" as const, userScope: "dream:read", input, output });
const userWrite = <Input extends z.ZodType, Output extends z.ZodType>(input: Input, output: Output) =>
  ({ kind: "write" as const, audience: "user" as const, userScope: "dream:write", input, output });
const backgroundRead = <Input extends z.ZodType, Output extends z.ZodType>(input: Input, output: Output) =>
  ({ kind: "read" as const, audience: "background" as const, backgroundScope: "connectors:sync", input, output });
const backgroundWrite = <Input extends z.ZodType, Output extends z.ZodType>(input: Input, output: Output) =>
  ({ kind: "write" as const, audience: "background" as const, backgroundScope: "connectors:sync", input, output });

export const notionConnectorOperationContracts = {
  "notion.connector.create": userWrite(notionConnectorCreateInputDto, notionConnectorOutputDto),
  "notion.connector.list": userRead(notionConnectorListInputDto, notionConnectorListOutputDto),
  "notion.connector.get": userRead(notionConnectorGetInputDto, notionConnectorNullableOutputDto),
  "notion.connector.active": userRead(notionConnectorActiveInputDto, notionConnectorNullableOutputDto),
  "notion.connector.patch": userWrite(notionConnectorPatchInputDto, notionConnectorOutputDto),
  "notion.connector.delete": userWrite(notionConnectorDeleteInputDto, notionConnectorDeleteOutputDto),
  "notion.auth-state.save": userWrite(notionAuthStateSaveInputDto, notionConnectorOutputDto),
  "notion.resources.replace": userWrite(notionResourcesReplaceInputDto, notionConnectorOutputDto),
  "notion.resources.list": userRead(notionResourcesListInputDto, notionResourcesListOutputDto),
  "notion.resource.delete": userWrite(notionResourceDeleteInputDto, notionResourceDeleteOutputDto),
  "notion.snapshot.save": userWrite(notionSnapshotSaveInputDto, notionSnapshotOutputDto),
  "notion.snapshot.current": userRead(notionSnapshotCurrentInputDto, notionSnapshotNullableOutputDto),
  "notion.snapshot.get": userRead(notionSnapshotGetInputDto, notionSnapshotNullableOutputDto),
  "notion.snapshot.list": userRead(notionSnapshotListInputDto, notionSnapshotListOutputDto),
  "notion.thread.attach": userWrite(notionThreadAttachInputDto, notionConnectorOutputDto),
  "notion.thread.resolve": userRead(notionThreadResolveInputDto, notionConnectorNullableOutputDto),
  "notion.sync-candidates.list": backgroundRead(notionSyncCandidatesInputDto, notionSyncCandidatesOutputDto),
  "notion.sync-connector.get": backgroundRead(notionSyncConnectorInputDto, notionConnectorNullableOutputDto),
  "notion.sync-connector.patch": backgroundWrite(notionSyncConnectorPatchInputDto, notionConnectorOutputDto),
  "notion.sync-resources.list": backgroundRead(notionSyncResourcesInputDto, notionResourcesListOutputDto),
  "notion.sync-snapshot.save": backgroundWrite(notionSyncSnapshotSaveInputDto, notionSnapshotOutputDto),
} as const;

export type NotionConnectorOperation = keyof typeof notionConnectorOperationContracts;
export type NotionConnectorUserOperation = {
  [Name in NotionConnectorOperation]: typeof notionConnectorOperationContracts[Name]["audience"] extends "user" ? Name : never
}[NotionConnectorOperation];
export type NotionConnectorBackgroundOperation = Exclude<NotionConnectorOperation, NotionConnectorUserOperation>;
export type NotionAuthority = z.infer<typeof notionAuthorityDto>;
