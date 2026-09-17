// [Input] Canonical actor or background connector ID plus one caller-owned Admin data transaction.
// [Output] Owner-filtered connector, resource, snapshot and Thread-binding persistence.
// [Pos] Typed Drizzle Repository for the Notion connector domain; no HTTP, Notion SDK or filesystem access.
// [Sync] 2026-09-17: project storage-only JSON columns into strict public DTO fields without leaking ORM row keys.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  connector_chat_threads as connectorThreads,
  connector_resource_pages as resourcePages,
  connector_resources as resources,
  connector_snapshots as snapshots,
  resource_connectors as connectors,
} from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import { pgTimestampToIso } from "./chatThreadDto";
import type { DataTransaction } from "./database";
import * as dto from "./notionConnectorDto";

type ConnectorPatch = z.infer<typeof dto.notionConnectorPatchDto>;
type ResourceSelection = z.infer<typeof dto.notionResourceSelectionDto>;
type SnapshotSave = z.infer<typeof dto.notionSnapshotSaveCoreDto>;

function parseObject(raw: string, errorCode: string) {
  try {
    return z.record(z.string(), z.json()).parse(JSON.parse(raw));
  } catch {
    throw new AuthBoundaryError(errorCode, 503);
  }
}

function timestamp(value: string | null) {
  return value === null ? null : pgTimestampToIso(value);
}

function pageTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) {
    throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
  }
  return new Date(value).toISOString();
}

export class NotionConnectorRepository {
  private readonly actor: string | null;

  constructor(private readonly tx: DataTransaction, actor: string | null) {
    this.actor = actor === null ? null : decimalIdDto.parse(actor);
  }

  private actorValue() {
    if (this.actor === null) throw new AuthBoundaryError("NOTION_BACKGROUND_ACTOR_FORBIDDEN", 403);
    return sql`${this.actor}::bigint`;
  }

  private connectorSelection() {
    return {
      id: connectors.id,
      user_id: sql<string>`${connectors.user_id}::text`,
      name: connectors.name,
      platform: connectors.platform,
      auth_status: connectors.auth_status,
      config_json: connectors.config_json,
      current_snapshot_version: connectors.current_snapshot_version,
      current_source_revision: connectors.current_source_revision,
      current_sync_cursor: connectors.current_sync_cursor,
      last_synced_at: connectors.last_synced_at,
      created_at: connectors.created_at,
      updated_at: connectors.updated_at,
    };
  }

  private resourceSelection() {
    return {
      id: resources.id,
      connector_id: resources.connector_id,
      resource_type: resources.resource_type,
      external_id: resources.external_id,
      title: resources.title,
      metadata_json: resources.metadata_json,
      sync_status: resources.sync_status,
      created_at: resources.created_at,
      updated_at: resources.updated_at,
    };
  }

  private projectResource(row: Record<string, unknown>) {
    const { metadata_json, ...publicRow } = row;
    return dto.notionResourceDto.parse({
      ...publicRow,
      metadata: parseObject(String(metadata_json), "NOTION_RESOURCE_DATA_INVALID"),
      created_at: pgTimestampToIso(String(row.created_at)),
      updated_at: pgTimestampToIso(String(row.updated_at)),
    });
  }

  private async projectConnector(row: Record<string, unknown>) {
    const { config_json, ...publicRow } = row;
    return dto.notionConnectorDto.parse({
      ...publicRow,
      config: parseObject(String(config_json), "NOTION_CONNECTOR_DATA_INVALID"),
      last_synced_at: timestamp(row.last_synced_at === null ? null : String(row.last_synced_at)),
      created_at: pgTimestampToIso(String(row.created_at)),
      updated_at: pgTimestampToIso(String(row.updated_at)),
      sources: await this.listResources(String(row.id)),
    });
  }

  private actorFilter() {
    return eq(connectors.user_id, this.actorValue());
  }

  private async connectorRow(connectorId: string, lock = false, background = false) {
    const where = background
      ? eq(connectors.id, connectorId)
      : and(eq(connectors.id, connectorId), this.actorFilter());
    let query = this.tx.select(this.connectorSelection()).from(connectors).where(where).limit(1);
    if (lock) query = query.for("update", { of: connectors }) as typeof query;
    return (await query)[0] ?? null;
  }

  async connector(connectorId: string, options: { lock?: boolean; background?: boolean } = {}) {
    const row = await this.connectorRow(connectorId, options.lock, options.background);
    return row ? this.projectConnector(row) : null;
  }

  async requireConnector(connectorId: string, options: { lock?: boolean; background?: boolean } = {}) {
    const connector = await this.connector(connectorId, options);
    if (!connector) throw new AuthBoundaryError("NOTION_CONNECTOR_NOT_FOUND", 404);
    return connector;
  }

  async create(name: string, platform: string, config: Record<string, unknown>) {
    const id = randomUUID();
    await this.tx.insert(connectors).values({
      id,
      user_id: this.actorValue(),
      name,
      platform,
      auth_status: "pending",
      config_json: JSON.stringify(config),
    });
    return this.requireConnector(id);
  }

  async list() {
    const rows = await this.tx.select(this.connectorSelection()).from(connectors)
      .where(this.actorFilter()).orderBy(desc(connectors.updated_at), desc(connectors.created_at));
    return Promise.all(rows.map(row => this.projectConnector(row)));
  }

  async active() {
    const row = (await this.tx.select(this.connectorSelection()).from(connectors)
      .where(this.actorFilter()).orderBy(
        sql`CASE ${connectors.auth_status} WHEN 'authenticated' THEN 0 WHEN 'pending' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END`,
        desc(connectors.updated_at), desc(connectors.created_at),
      ).limit(1))[0];
    return row ? this.projectConnector(row) : null;
  }

  async syncCandidates() {
    const rows = await this.tx.select(this.connectorSelection()).from(connectors).where(and(
      eq(connectors.platform, "notion"), eq(connectors.auth_status, "authenticated"),
    )).orderBy(asc(connectors.updated_at), asc(connectors.created_at));
    return Promise.all(rows.map(row => this.projectConnector(row)));
  }

  async patch(connectorId: string, patch: ConnectorPatch, background = false) {
    const current = await this.requireConnector(connectorId, { lock: true, background });
    const config = { ...current.config, ...(patch.config_patch ?? {}) };
    const where = background
      ? eq(connectors.id, connectorId)
      : and(eq(connectors.id, connectorId), this.actorFilter());
    const rows = await this.tx.update(connectors).set({
      name: patch.name ?? current.name,
      platform: patch.platform ?? current.platform,
      auth_status: patch.auth_status ?? current.auth_status,
      config_json: JSON.stringify(config),
      current_snapshot_version: Object.hasOwn(patch, "current_snapshot_version") ? patch.current_snapshot_version : current.current_snapshot_version,
      current_source_revision: Object.hasOwn(patch, "current_source_revision") ? patch.current_source_revision : current.current_source_revision,
      current_sync_cursor: Object.hasOwn(patch, "current_sync_cursor") ? patch.current_sync_cursor : current.current_sync_cursor,
      last_synced_at: Object.hasOwn(patch, "last_synced_at") ? patch.last_synced_at : current.last_synced_at,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(where).returning({ id: connectors.id });
    if (rows.length !== 1) throw new AuthBoundaryError("NOTION_CONNECTOR_NOT_FOUND", 404);
    return this.requireConnector(connectorId, { background });
  }

  async delete(connectorId: string) {
    const rows = await this.tx.delete(connectors).where(and(
      eq(connectors.id, connectorId), this.actorFilter(),
    )).returning({ id: connectors.id });
    return rows.length === 1;
  }

  async listResources(connectorId: string) {
    const rows = await this.tx.select(this.resourceSelection()).from(resources)
      .where(eq(resources.connector_id, connectorId))
      .orderBy(resources.resource_type, sql`lower(${resources.title})`, resources.title, desc(resources.created_at));
    return rows.map(row => this.projectResource(row));
  }

  private async insertResource(connectorId: string, resourceType: "notion_database" | "notion_page", item: ResourceSelection) {
    await this.tx.insert(resources).values({
      id: randomUUID(), connector_id: connectorId, resource_type: resourceType,
      external_id: item.external_id, title: item.title, metadata_json: JSON.stringify(item.metadata),
      sync_status: "synced",
    });
  }

  async replaceResources(connectorId: string, databases: ResourceSelection[], pages: ResourceSelection[]) {
    const current = await this.requireConnector(connectorId, { lock: true });
    await this.tx.delete(resources).where(and(
      eq(resources.connector_id, connectorId),
      sql`${resources.resource_type} IN ('notion_database', 'notion_page')`,
    ));
    for (const item of databases) await this.insertResource(connectorId, "notion_database", item);
    for (const item of pages) await this.insertResource(connectorId, "notion_page", item);
    await this.tx.update(connectors).set({
      config_json: JSON.stringify({
        ...current.config,
        selected_databases: databases.map(item => item.external_id),
        selected_pages: pages.map(item => item.external_id),
      }),
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(connectors.id, connectorId), this.actorFilter()));
    return this.requireConnector(connectorId);
  }

  async deleteResource(connectorId: string, resourceId: string) {
    await this.requireConnector(connectorId, { lock: true });
    const rows = await this.tx.delete(resources).where(and(
      eq(resources.id, resourceId), eq(resources.connector_id, connectorId),
    )).returning({ id: resources.id });
    return rows.length === 1;
  }

  private async snapshotRow(connectorId: string, version: string | null) {
    const where = version === null
      ? and(eq(snapshots.connector_id, connectorId), eq(snapshots.snapshot_version, connectors.current_snapshot_version))
      : and(eq(snapshots.connector_id, connectorId), eq(snapshots.snapshot_version, version));
    return (await this.tx.select({ snapshot_json: snapshots.snapshot_json }).from(snapshots)
      .innerJoin(connectors, eq(connectors.id, snapshots.connector_id))
      .where(and(where, this.actorFilter())).limit(1))[0] ?? null;
  }

  async snapshot(connectorId: string, version: string | null) {
    const row = await this.snapshotRow(connectorId, version);
    return row ? dto.notionSnapshotDto.parse(parseObject(row.snapshot_json, "NOTION_SNAPSHOT_DATA_INVALID")) : null;
  }

  async listSnapshots(connectorId: string) {
    await this.requireConnector(connectorId);
    const rows = await this.tx.select({
      id: snapshots.id, connector_id: snapshots.connector_id, snapshot_version: snapshots.snapshot_version,
      source_revision: snapshots.source_revision, sync_cursor: snapshots.sync_cursor,
      fetched_at: snapshots.fetched_at, state: snapshots.state, snapshot_json: snapshots.snapshot_json,
      created_at: snapshots.created_at, updated_at: snapshots.updated_at,
    }).from(snapshots).where(eq(snapshots.connector_id, connectorId)).orderBy(desc(snapshots.created_at));
    return rows.map(row => {
      const { snapshot_json, ...publicRow } = row;
      return dto.notionSnapshotRecordDto.parse({
        ...publicRow,
        fetched_at: pgTimestampToIso(row.fetched_at),
        created_at: pgTimestampToIso(row.created_at),
        updated_at: pgTimestampToIso(row.updated_at),
        snapshot: parseObject(snapshot_json, "NOTION_SNAPSHOT_DATA_INVALID"),
      });
    });
  }

  async saveSnapshot(input: SnapshotSave, background = false) {
    const current = await this.requireConnector(input.connector_id, { lock: true, background });
    const metadata = dto.notionSnapshotMetadataDto.parse(input.snapshot.metadata);
    if (metadata.resource_connector_id !== input.connector_id || metadata.workspace_id !== input.workspace_id) {
      throw new AuthBoundaryError("NOTION_SNAPSHOT_IDENTITY_CONFLICT", 409);
    }
    await this.tx.insert(snapshots).values({
      id: randomUUID(), connector_id: input.connector_id,
      snapshot_version: metadata.snapshot_version, source_revision: metadata.source_revision,
      sync_cursor: metadata.sync_cursor, fetched_at: metadata.fetched_at, state: metadata.state,
      snapshot_json: JSON.stringify(input.snapshot), created_at: metadata.fetched_at,
    }).onConflictDoUpdate({
      target: [snapshots.connector_id, snapshots.snapshot_version],
      set: {
        source_revision: metadata.source_revision, sync_cursor: metadata.sync_cursor,
        fetched_at: metadata.fetched_at, state: metadata.state,
        snapshot_json: JSON.stringify(input.snapshot), updated_at: sql`CURRENT_TIMESTAMP`,
      },
    });
    const databasePages = input.snapshot.database_pages;
    if (typeof databasePages !== "object" || databasePages === null || Array.isArray(databasePages)) {
      throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
    }
    for (const [databaseId, rawPages] of Object.entries(databasePages)) {
      if (!Array.isArray(rawPages)) throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
      const resource = (await this.tx.select({ id: resources.id }).from(resources).where(and(
        eq(resources.connector_id, input.connector_id), eq(resources.resource_type, "notion_database"),
        eq(resources.external_id, databaseId),
      )).limit(1))[0];
      if (!resource) continue;
      await this.tx.delete(resourcePages).where(eq(resourcePages.resource_id, resource.id));
      for (const rawPage of rawPages) {
        const page = z.record(z.string(), z.json()).safeParse(rawPage);
        if (!page.success) throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
        const pageId = String(page.data.page_id ?? page.data.id ?? "").trim();
        if (!pageId) continue;
        const properties = page.data.properties;
        await this.tx.insert(resourcePages).values({
          id: randomUUID(), resource_id: resource.id, page_id: pageId,
          title: String(page.data.title ?? pageId), last_edited: pageTimestamp(page.data.last_edited),
          properties_json: JSON.stringify(typeof properties === "object" && properties !== null && !Array.isArray(properties) ? properties : {}),
          page_json: JSON.stringify(page.data), created_at: metadata.fetched_at,
        });
      }
    }
    for (const item of input.synced_resources) {
      await this.tx.update(resources).set({ sync_status: "synced", updated_at: sql`CURRENT_TIMESTAMP` }).where(and(
        eq(resources.connector_id, input.connector_id), eq(resources.resource_type, item.resource_type),
        eq(resources.external_id, item.external_id),
      ));
    }
    const where = background
      ? eq(connectors.id, input.connector_id)
      : and(eq(connectors.id, input.connector_id), this.actorFilter());
    await this.tx.update(connectors).set({
      current_snapshot_version: metadata.snapshot_version,
      current_source_revision: metadata.source_revision,
      current_sync_cursor: metadata.sync_cursor,
      last_synced_at: metadata.fetched_at,
      auth_status: "authenticated",
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(where);
    void current;
    return dto.notionSnapshotDto.parse(input.snapshot);
  }

  async attachThread(connectorId: string, threadId: string) {
    await this.requireConnector(connectorId, { lock: true });
    await this.tx.insert(connectorThreads).values({
      id: randomUUID(), connector_id: connectorId, thread_id: threadId,
    }).onConflictDoUpdate({
      target: [connectorThreads.connector_id, connectorThreads.thread_id],
      set: { updated_at: sql`CURRENT_TIMESTAMP` },
    });
    return this.requireConnector(connectorId);
  }

  async connectorForThread(threadId: string) {
    const row = (await this.tx.select(this.connectorSelection()).from(connectorThreads)
      .innerJoin(connectors, eq(connectors.id, connectorThreads.connector_id))
      .where(and(eq(connectorThreads.thread_id, threadId), this.actorFilter()))
      .orderBy(desc(connectorThreads.updated_at)).limit(1))[0];
    return row ? this.projectConnector(row) : null;
  }
}
