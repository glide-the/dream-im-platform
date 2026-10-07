// [Input] Verified-service worker identity, canonical connector and strict metadata-only finish result.
// [Output] Four named single-owner sync contracts appended without changing legacy descriptors.
// [Pos] Internal Admin/Dream DTO; browser requests never carry run, fence or lease settings.
// [Sync] 2026-10-07: share claim core across manual/user and scheduled/service ingress.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { notionSyncExecutionPolicyDto } from "../../../config/notion-sync-policy";
import { notionAuthorityDto, notionConnectorDto, notionConnectorOperationContracts, notionSyncedResourceDto } from "./notionConnectorDto";
import { notionLightSnapshotDto } from "./notionLightSnapshotDto";
import { notionRunDto } from "./notionSyncRunState";
const claim = { connector_id: z.uuid(), worker_id: z.uuid() };
export const notionSyncRunRequestDto = z.strictObject({ authority: notionAuthorityDto, ...claim });
export const notionSyncRunClaimDto = z.strictObject(claim);
export const notionSyncRunKeyDto = z.strictObject({ ...claim, run_id: z.uuid(), fence_epoch: z.number().int().positive().safe() });
export const notionSyncRunFinishDto = z.strictObject({
  ...notionSyncRunKeyDto.shape,
  outcome: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("succeeded"), workspace_id: z.string().min(1).max(255), snapshot: notionLightSnapshotDto, synced_resources: z.array(notionSyncedResourceDto).max(20_000) }),
    z.strictObject({ status: z.literal("failed"), error_code: z.enum(["NOTION_SYNC_FAILED", "NOTION_UPSTREAM_UNAVAILABLE"]) }),
    z.strictObject({ status: z.literal("cancelled"), error_code: z.literal("NOTION_SYNC_CANCELLED") }),
  ]),
});
export const notionSyncRunOutputDto = z.strictObject({
  status: z.enum(["claimed", "busy", "not_due", "renewed", "succeeded", "failed", "cancelled"]),
  connector: notionConnectorDto, run: notionRunDto.nullable(),
  server_now: isoTimeDto, retry_at: isoTimeDto.nullable(), execution_policy: notionSyncExecutionPolicyDto,
  snapshot: notionLightSnapshotDto.nullable(),
});
export const notionSyncRunOperationContracts = {
  "notion.sync-run.request": { kind: "write", audience: "user", userScope: "dream:write", input: notionSyncRunRequestDto, output: notionSyncRunOutputDto },
  "notion.sync-run.claim": { kind: "write", audience: "background", backgroundScope: "connectors:sync", input: notionSyncRunClaimDto, output: notionSyncRunOutputDto },
  "notion.sync-run.renew": { kind: "write", audience: "background", backgroundScope: "connectors:sync", input: notionSyncRunKeyDto, output: notionSyncRunOutputDto },
  "notion.sync-run.finish": { kind: "write", audience: "background", backgroundScope: "connectors:sync", input: notionSyncRunFinishDto, output: notionSyncRunOutputDto },
} as const;
export const allNotionOperationContracts = { ...notionConnectorOperationContracts, ...notionSyncRunOperationContracts } as const;
export type NotionOperation = keyof typeof allNotionOperationContracts;
export type NotionUserOperation = { [Name in NotionOperation]: typeof allNotionOperationContracts[Name]["audience"] extends "user" ? Name : never }[NotionOperation];
export type NotionBackgroundOperation = Exclude<NotionOperation, NotionUserOperation>;
