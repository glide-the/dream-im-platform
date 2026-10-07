// [Input] Canonical metadata snapshot produced by Dream's existing build_canonical_snapshot.
// [Output] Strict lightweight connector/index/database metadata; body/config/reserved fields are rejected.
// [Pos] New execution finish boundary only; legacy 21 operation descriptors remain frozen.
// [Sync] 2026-10-07: validate complete shape, identity copies and database index coverage before persistence.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { notionSnapshotMetadataDto } from "./notionConnectorDto";
const id = z.string().trim().min(1).max(255);
const time = z.union([isoTimeDto, z.literal("")]);
export const notionLightPageDto = z.strictObject({ page_id: id, title: z.string(), url: z.string(),
  last_edited: time, created_time: time.nullable(), last_edited_time: time.nullable() });
export const notionLightSnapshotDto = z.strictObject({
  metadata: notionSnapshotMetadataDto,
  connector: z.strictObject({ id: z.uuid(), name: z.string(), platform: z.literal("notion"),
    auth_status: z.literal("authenticated"), last_synced_at: isoTimeDto.nullable(),
    selected_databases: z.array(id).max(10_000), selected_pages: z.array(id).max(10_000) }),
  index: z.array(notionLightPageDto),
  databases: z.array(z.strictObject({ database_id: id, title: z.string(), page_count: z.number().int().nonnegative().safe(),
    properties_schema: z.record(z.string(), z.json()), last_edited: time, url: z.string() })),
  database_pages: z.record(id, z.array(notionLightPageDto)), pages: z.strictObject({}),
  identity: z.strictObject({ snapshot_version: id, source_revision: id, sync_cursor: id,
    workspace_id: id, resource_connector_id: z.uuid() }),
}).superRefine((snapshot, context) => {
  if (snapshot.connector.id !== snapshot.metadata.resource_connector_id
    || Object.entries(snapshot.identity).some(([key, value]) => snapshot.metadata[key as keyof typeof snapshot.metadata] !== value))
    context.addIssue({ code: "custom", message: "Snapshot identity does not match metadata" });
  const databases = new Set(snapshot.connector.selected_databases);
  const selectedPages = new Set(snapshot.connector.selected_pages.map(value => value.replaceAll("-", "").toLowerCase()));
  const summaries = new Set(snapshot.databases.map(value => value.database_id));
  const pageKeys = Object.keys(snapshot.database_pages);
  if (databases.size !== snapshot.connector.selected_databases.length || selectedPages.size !== snapshot.connector.selected_pages.length
    || summaries.size !== snapshot.databases.length || databases.size !== summaries.size || databases.size !== pageKeys.length
    || pageKeys.some(key => !databases.has(key)) || snapshot.databases.some(db => !databases.has(db.database_id)
      || snapshot.database_pages[db.database_id]?.length !== db.page_count))
    context.addIssue({ code: "custom", message: "Snapshot databases do not match its selected resources" });
  const databasePageIds = Object.values(snapshot.database_pages).flat().map(page => page.page_id.replaceAll("-", "").toLowerCase());
  const allowedPages = new Set([...selectedPages, ...databasePageIds]);
  const indexIds = snapshot.index.map(page => page.page_id.replaceAll("-", "").toLowerCase());
  const indexedPages = new Set(indexIds);
  if (indexedPages.size !== indexIds.length || indexIds.some(key => !allowedPages.has(key))
    || databasePageIds.some(key => !indexedPages.has(key)))
    context.addIssue({ code: "custom", message: "Snapshot index must cover all database pages without unselected or duplicate pages" });
});
