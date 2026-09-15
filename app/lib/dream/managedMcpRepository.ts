// [Input] Canonical actor, optional exact Runtime authority and one caller-owned Admin data transaction.
// [Output] Actor/workspace-filtered Server, App settings, encrypted credential, discovery and import persistence.
// [Pos] Typed Drizzle Repository for Registry134-147; no network, MCP SDK, plaintext credential or caller SQL.
// [Sync] 2026-09-16: move the complete Dream managed-MCP PostgreSQL repository into Admin.
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  dream_mcp_credentials as credentials,
  dream_mcp_discovery_snapshots as snapshots,
  dream_mcp_import_receipts as importReceipts,
  dream_mcp_servers as servers,
  workflow_runs as workflowRuns,
} from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import { canonicalContractJson } from "./canonicalContractJson";
import { pgTimestampToIso } from "./chatThreadDto";
import type { DataTransaction } from "./database";
import * as dto from "./managedMcpDto";

type ScopeSelector = string | null | undefined;

export class ManagedMcpRepository {
  private readonly actor: string;

  constructor(
    private readonly tx: DataTransaction,
    actor: string,
    private readonly authority: dto.ManagedMcpAuthority,
  ) {
    this.actor = decimalIdDto.parse(actor);
  }

  private actorValue() { return sql`${this.actor}::bigint`; }

  private async authorityWorkspace(requested: ScopeSelector) {
    if (this.authority === null) return requested;
    if (this.authority.workflow_run_id === null) {
      if (requested !== undefined && requested !== null) {
        throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
      }
      return null;
    }
    const row = (await this.tx.select({ workspace_id: workflowRuns.workspace_id })
      .from(workflowRuns)
      .innerJoin(workspaces, eq(workspaces.id, workflowRuns.workspace_id))
      .where(and(
        eq(workflowRuns.id, this.authority.workflow_run_id),
        eq(workflowRuns.source_voice_thread_id, this.authority.thread_id),
        eq(workflowRuns.created_by, this.actor),
        eq(workspaces.owner_id, this.actorValue()),
      )).limit(1))[0];
    if (!row || (requested !== undefined && requested !== null && requested !== row.workspace_id)) {
      throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    }
    return row.workspace_id;
  }

  private async visibility(requested: ScopeSelector) {
    const workspace = await this.authorityWorkspace(requested);
    const owner = eq(servers.user_id, this.actorValue());
    if (this.authority === null && requested === undefined) return owner;
    return and(owner, or(
      and(eq(servers.scope_type, "user"), isNull(servers.scope_id)),
      ...(workspace === null || workspace === undefined
        ? []
        : [and(eq(servers.scope_type, "workspace"), eq(servers.scope_id, workspace))]),
    ));
  }

  private selection() {
    return {
      id: servers.id,
      user_id: sql<string>`${servers.user_id}::text`,
      workspace_id: servers.scope_id,
      scope: servers.scope_type,
      server_key: servers.server_key,
      display_name: servers.display_name,
      transport: servers.transport,
      remote_url: servers.remote_url,
      stdio_profile_key: servers.stdio_profile_key,
      auth_kind: servers.auth_kind,
      enabled: servers.enabled,
      config_revision: servers.config_revision,
      credential_revision: credentials.credential_revision,
      credential_id: credentials.id,
      created_at: servers.created_at,
      updated_at: servers.updated_at,
    };
  }

  private projectServer(row: Record<string, unknown>) {
    return dto.managedMcpServerDto.parse({
      ...row,
      credential_revision: row.credential_revision ?? 0,
      credential_id: row.credential_id ?? null,
      credential_configured: row.credential_id !== null && row.credential_id !== undefined,
      created_at: pgTimestampToIso(String(row.created_at)),
      updated_at: pgTimestampToIso(String(row.updated_at)),
    });
  }

  async listServers(workspaceId: string | null) {
    const rows = await this.tx.select(this.selection()).from(servers)
      .leftJoin(credentials, eq(credentials.server_id, servers.id))
      .where(await this.visibility(workspaceId))
      .orderBy(desc(servers.updated_at), servers.id);
    return rows.map(row => this.projectServer(row));
  }

  async server(identifier: string, workspaceId: string | null) {
    const rows = await this.tx.select(this.selection()).from(servers)
      .leftJoin(credentials, eq(credentials.server_id, servers.id))
      .where(and(await this.visibility(workspaceId), or(
        eq(servers.id, identifier), eq(servers.server_key, identifier),
      ))).orderBy(desc(sql`${servers.id} = ${identifier}`)).limit(1);
    return rows[0] ? this.projectServer(rows[0]) : null;
  }

  private async serverById(serverId: string, requested: ScopeSelector = undefined, lock = false) {
    let query = this.tx.select(this.selection()).from(servers)
      .leftJoin(credentials, eq(credentials.server_id, servers.id))
      .where(and(await this.visibility(requested), eq(servers.id, serverId))).limit(1);
    if (lock) query = query.for("update", { of: servers }) as typeof query;
    const row = (await query)[0];
    return row ? this.projectServer(row) : null;
  }

  private async requireWorkspaceOwner(workspaceId: string) {
    const row = (await this.tx.select({ id: workspaces.id }).from(workspaces).where(and(
      eq(workspaces.id, workspaceId), eq(workspaces.owner_id, this.actorValue()),
    )).limit(1))[0];
    if (!row) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_OWNERSHIP_CONFLICT", 409);
  }

  async createServer(input: z.infer<typeof dto.managedMcpServerCreateDto>) {
    await this.authorityWorkspace(input.workspace_id);
    if (input.scope === "workspace") await this.requireWorkspaceOwner(input.workspace_id!);
    const id = randomUUID();
    const inserted = await this.tx.insert(servers).values({
      id,
      user_id: this.actorValue(),
      server_key: input.server_key,
      display_name: input.display_name,
      scope_type: input.scope,
      scope_id: input.workspace_id,
      transport: input.transport,
      remote_url: input.remote_url,
      stdio_profile_key: input.stdio_profile_key,
      auth_kind: input.auth_kind,
      enabled: input.enabled,
      config_revision: 1,
    }).onConflictDoNothing().returning({ id: servers.id });
    if (inserted.length !== 1) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_ALREADY_EXISTS", 409);
    const result = await this.serverById(id);
    if (!result) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    return result;
  }

  async updateServer(input: z.infer<typeof dto.managedMcpServerPatchDto>) {
    const current = await this.serverById(input.server_id, undefined, true);
    if (!current) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    if (current.config_revision !== input.expected_revision) {
      throw new AuthBoundaryError("CLAUDE_MCP_SERVER_REVISION_CONFLICT", 409);
    }
    const nextTransport = input.transport ?? current.transport;
    let remoteUrl = input.remote_url ?? current.remote_url;
    let stdioProfileKey = input.stdio_profile_key ?? current.stdio_profile_key;
    if (input.transport === "stdio") remoteUrl = null;
    if (input.transport === "sse" || input.transport === "streamable_http") stdioProfileKey = null;
    const next = dto.managedMcpServerCreateDto.safeParse({
      authority: input.authority,
      workspace_id: current.workspace_id,
      server_key: current.server_key,
      display_name: input.display_name ?? current.display_name,
      transport: nextTransport,
      auth_kind: input.auth_kind ?? current.auth_kind,
      scope: current.scope,
      remote_url: remoteUrl,
      stdio_profile_key: stdioProfileKey,
      enabled: input.enabled ?? current.enabled,
    });
    if (!next.success) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_CONFIGURATION_INVALID", 422);
    const invalidateCredential = current.credential_configured && (
      next.data.transport !== current.transport
      || next.data.remote_url !== current.remote_url
      || next.data.stdio_profile_key !== current.stdio_profile_key
      || next.data.auth_kind !== current.auth_kind
    );
    if (invalidateCredential) {
      await this.tx.delete(credentials).where(eq(credentials.server_id, input.server_id));
      await this.tx.delete(snapshots).where(eq(snapshots.server_id, input.server_id));
    }
    const changed = await this.tx.update(servers).set({
      display_name: next.data.display_name,
      transport: next.data.transport,
      remote_url: next.data.remote_url,
      stdio_profile_key: next.data.stdio_profile_key,
      auth_kind: next.data.auth_kind,
      enabled: next.data.enabled,
      config_revision: sql`${servers.config_revision} + 1`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(servers.id, input.server_id),
      eq(servers.user_id, this.actorValue()),
      eq(servers.config_revision, input.expected_revision),
    )).returning({ id: servers.id });
    if (changed.length !== 1) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_REVISION_CONFLICT", 409);
    const result = await this.serverById(input.server_id);
    if (!result) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    return result;
  }

  async deleteServer(serverId: string, expectedRevision: number | null) {
    const current = await this.serverById(serverId, undefined, true);
    if (!current) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    if (expectedRevision !== null && expectedRevision !== current.config_revision) {
      throw new AuthBoundaryError("CLAUDE_MCP_SERVER_REVISION_CONFLICT", 409);
    }
    const deleted = await this.tx.delete(servers).where(and(
      eq(servers.id, serverId),
      eq(servers.user_id, this.actorValue()),
      eq(servers.config_revision, current.config_revision),
    )).returning({ id: servers.id });
    if (deleted.length !== 1) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_REVISION_CONFLICT", 409);
    return current;
  }

  async appSettings(serverId: string, workspaceId: string | null) {
    const row = (await this.tx.select({
      enabled: servers.app_desired_enabled,
      low_risk_tool_calls: servers.app_desired_low_risk_tool_calls,
      ui_messages: servers.app_desired_ui_messages,
      revision: servers.app_settings_revision,
    }).from(servers).where(and(
      await this.visibility(workspaceId), eq(servers.id, serverId),
    )).limit(1))[0];
    return row ? dto.managedMcpAppSettingsDto.parse({
      desired: {
        enabled: row.enabled,
        low_risk_tool_calls: row.low_risk_tool_calls,
        ui_messages: row.ui_messages,
      },
      revision: row.revision,
    }) : null;
  }

  async updateAppSettings(input: z.infer<typeof dto.managedMcpAppSettingsUpdateInputDto>) {
    const visibility = await this.visibility(input.workspace_id);
    const rows = await this.tx.update(servers).set({
      app_desired_enabled: input.desired.enabled,
      app_desired_low_risk_tool_calls: input.desired.low_risk_tool_calls,
      app_desired_ui_messages: input.desired.ui_messages,
      app_settings_revision: sql`${servers.app_settings_revision} + 1`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      visibility,
      eq(servers.id, input.server_id),
      eq(servers.app_settings_revision, input.expected_revision),
    )).returning({
      enabled: servers.app_desired_enabled,
      low_risk_tool_calls: servers.app_desired_low_risk_tool_calls,
      ui_messages: servers.app_desired_ui_messages,
      revision: servers.app_settings_revision,
    });
    if (rows[0]) return dto.managedMcpAppSettingsDto.parse({
      desired: {
        enabled: rows[0].enabled,
        low_risk_tool_calls: rows[0].low_risk_tool_calls,
        ui_messages: rows[0].ui_messages,
      },
      revision: rows[0].revision,
    });
    if (!await this.serverById(input.server_id, input.workspace_id)) {
      throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    }
    throw new AuthBoundaryError("CLAUDE_MCP_APP_SETTINGS_REVISION_CONFLICT", 409);
  }

  async credential(serverId: string) {
    const visible = await this.visibility(undefined);
    const row = (await this.tx.select({
      id: credentials.id,
      server_id: credentials.server_id,
      user_id: sql<string>`${servers.user_id}::text`,
      kind: credentials.kind,
      ciphertext: credentials.ciphertext,
      iv: credentials.iv,
      tag: credentials.tag,
      fingerprint: credentials.fingerprint,
      key_version: credentials.key_version,
      credential_revision: credentials.credential_revision,
      expires_at: credentials.expires_at,
    }).from(credentials).innerJoin(servers, eq(servers.id, credentials.server_id))
      .where(and(visible, eq(credentials.server_id, serverId))).limit(1))[0];
    return row ? dto.managedMcpCredentialDto.parse({
      ...row,
      expires_at: pgTimestampToIso(row.expires_at),
    }) : null;
  }

  async upsertCredential(input: z.infer<typeof dto.managedMcpCredentialUpsertInputDto>) {
    if (!await this.serverById(input.server_id)) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    const id = randomUUID();
    await this.tx.insert(credentials).values({
      id,
      server_id: input.server_id,
      kind: input.kind,
      ciphertext: input.envelope.ciphertext,
      iv: input.envelope.iv,
      tag: input.envelope.tag,
      fingerprint: input.envelope.fingerprint,
      key_version: input.envelope.key_version,
      credential_revision: 1,
      expires_at: input.expires_at,
    }).onConflictDoUpdate({
      target: credentials.server_id,
      set: {
        kind: input.kind,
        ciphertext: input.envelope.ciphertext,
        iv: input.envelope.iv,
        tag: input.envelope.tag,
        fingerprint: input.envelope.fingerprint,
        key_version: input.envelope.key_version,
        credential_revision: sql`${credentials.credential_revision} + 1`,
        expires_at: input.expires_at,
        updated_at: sql`CURRENT_TIMESTAMP`,
      },
    });
    await this.tx.delete(snapshots).where(eq(snapshots.server_id, input.server_id));
    const result = await this.credential(input.server_id);
    if (!result) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    return result;
  }

  async deleteCredential(serverId: string) {
    const current = await this.serverById(serverId, undefined, true);
    if (!current) throw new AuthBoundaryError("CLAUDE_MCP_SERVER_NOT_FOUND", 404);
    await this.tx.delete(credentials).where(eq(credentials.server_id, serverId));
    await this.tx.delete(snapshots).where(eq(snapshots.server_id, serverId));
    return dto.managedMcpServerDto.parse({
      ...current,
      credential_id: null,
      credential_configured: false,
      credential_revision: current.credential_revision + 1,
    });
  }

  async discovery(serverId: string, configRevision: number, credentialRevision: number) {
    const visible = await this.visibility(undefined);
    const row = (await this.tx.select({
      status: snapshots.status,
      inventory: snapshots.inventory,
      safe_error_code: snapshots.safe_error_code,
      discovered_at: snapshots.discovered_at,
    }).from(snapshots).innerJoin(servers, eq(servers.id, snapshots.server_id)).where(and(
      visible,
      eq(snapshots.server_id, serverId),
      eq(snapshots.config_revision, configRevision),
      credentialRevision === 0
        ? isNull(snapshots.credential_revision)
        : eq(snapshots.credential_revision, credentialRevision),
      gt(snapshots.expires_at, sql`CURRENT_TIMESTAMP`),
    )).orderBy(desc(snapshots.discovered_at)).limit(1))[0];
    return row ? dto.managedMcpDiscoverySnapshotDto.parse({
      ...row,
      discovered_at: pgTimestampToIso(row.discovered_at),
    }) : null;
  }

  async saveDiscovery(input: z.infer<typeof dto.managedMcpDiscoverySaveInputDto>) {
    const server = await this.serverById(input.server_id);
    if (!server || server.config_revision !== input.config_revision
      || server.credential_revision !== input.credential_revision) {
      throw new AuthBoundaryError("CLAUDE_MCP_SERVER_REVISION_CONFLICT", 409);
    }
    const actualHash = createHash("sha256")
      .update(canonicalContractJson(input.inventory), "utf8").digest("hex");
    if (actualHash !== input.inventory_sha256) {
      throw new AuthBoundaryError("CLAUDE_MCP_INVENTORY_MALFORMED", 422);
    }
    const now = Date.now();
    const expires = new Date(now + input.ttl_seconds * 1_000);
    if (!Number.isFinite(expires.getTime()) || expires.getTime() <= now) {
      throw new AuthBoundaryError("INPUT_INVALID", 400);
    }
    await this.tx.insert(snapshots).values({
      id: randomUUID(),
      server_id: input.server_id,
      config_revision: input.config_revision,
      credential_revision: input.credential_revision || null,
      status: input.status,
      inventory: input.inventory,
      inventory_sha256: actualHash,
      safe_error_code: input.safe_error_code,
      discovered_at: new Date(now).toISOString(),
      expires_at: expires.toISOString(),
    }).onConflictDoUpdate({
      target: [snapshots.server_id, snapshots.config_revision, snapshots.credential_revision],
      set: {
        status: input.status,
        inventory: input.inventory,
        inventory_sha256: actualHash,
        safe_error_code: input.safe_error_code,
        discovered_at: new Date(now).toISOString(),
        expires_at: expires.toISOString(),
      },
    });
  }

  async importReceipt(sourceHash: string) {
    await this.authorityWorkspace(undefined);
    const row = (await this.tx.select({
      state: importReceipts.state,
      target_server_id: importReceipts.target_server_id,
      canonical_config_sha256: importReceipts.canonical_config_sha256,
    }).from(importReceipts).where(and(
      eq(importReceipts.user_id, this.actorValue()),
      eq(importReceipts.source_item_sha256, sourceHash),
    )).orderBy(desc(importReceipts.created_at)).limit(1))[0];
    return row ? dto.managedMcpImportReceiptDto.parse(row) : null;
  }

  async importServer(input: z.infer<typeof dto.managedMcpImportInputDto>) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.actor}:${input.source_hash}`}, 0))`);
    const prior = await this.importReceipt(input.source_hash);
    if (prior) return dto.managedMcpImportReceiptDto.parse({ ...prior, state: "noop" });
    await this.authorityWorkspace(input.workspace_id);
    if (input.scope === "workspace") await this.requireWorkspaceOwner(input.workspace_id!);
    const conflict = (await this.tx.select({ id: servers.id }).from(servers).where(and(
      eq(servers.user_id, this.actorValue()),
      eq(servers.scope_type, input.scope),
      input.workspace_id === null ? isNull(servers.scope_id) : eq(servers.scope_id, input.workspace_id),
      eq(servers.server_key, input.server_key),
    )).limit(1))[0];
    let state: "imported" | "conflict";
    let targetServerId: string | null;
    if (conflict) {
      state = "conflict";
      targetServerId = null;
    } else {
      const id = randomUUID();
      await this.tx.insert(servers).values({
        id,
        user_id: this.actorValue(),
        server_key: input.server_key,
        display_name: input.display_name,
        scope_type: input.scope,
        scope_id: input.workspace_id,
        transport: input.transport,
        remote_url: input.remote_url,
        stdio_profile_key: input.stdio_profile_key,
        auth_kind: input.auth_kind,
        enabled: input.enabled,
        config_revision: 1,
      });
      state = "imported";
      targetServerId = id;
    }
    await this.tx.insert(importReceipts).values({
      id: randomUUID(),
      user_id: this.actorValue(),
      source_item_sha256: input.source_hash,
      canonical_config_sha256: input.config_hash,
      target_server_id: targetServerId,
      state,
      run_id: input.run_id ?? randomUUID(),
    });
    return dto.managedMcpImportReceiptDto.parse({
      state,
      target_server_id: targetServerId,
      canonical_config_sha256: input.config_hash,
    });
  }
}
