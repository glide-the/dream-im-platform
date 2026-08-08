import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import type { AiProviderProtocol } from "../billing/types";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { decryptCredential } from "../security/credential-encryption";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import type { AdminIdentity } from "./session";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

type ProviderDiscoveryRow = {
  id: string;
  code: string;
  name: string;
  protocol: AiProviderProtocol;
  base_url: string;
  timeout_ms: number;
  config: Record<string, unknown> | null;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  updated_at: Date;
  updated_at_token: string;
};

export type DiscoveredModel = {
  id: string;
  ownedBy: string | null;
  displayName: string;
};

export type DiscoveryDiffItem = DiscoveredModel & {
  proposedCode: string;
  state: "new" | "existing" | "conflict";
  existingModelId?: string;
  conflictReason?: string;
};

type DiscoverySnapshot = {
  id: string;
  provider_id: string;
  provider_code: string;
  provider_name: string;
  status: "ready" | "applied" | "expired";
  endpoint: string;
  catalog_hash: string;
  models: DiscoveredModel[];
  diff: DiscoveryDiffItem[];
  expires_at: Date;
  applied_at: Date | null;
  created_at: Date;
};

const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 5_000;

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

export function providerModelEndpointCandidates(
  input: Pick<ProviderDiscoveryRow, "protocol" | "base_url" | "config">,
) {
  const base = resolveProviderBaseUrl({ protocol: input.protocol, baseUrl: input.base_url });
  const configured = typeof input.config?.modelsUrl === "string"
    ? input.config.modelsUrl.trim()
    : "";
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  const candidates: string[] = [];
  if (configured) candidates.push(configured);

  const append = (pathname: string) => {
    const candidate = new URL(url.toString());
    candidate.pathname = pathname.replace(/\/{2,}/g, "/");
    candidates.push(candidate.toString());
  };
  if (/\/v\d+$/i.test(path)) append(`${path}/models`);
  else {
    append(`${path}/v1/models`);
    append(`${path}/models`);
  }
  if (/\/anthropic$/i.test(path)) {
    const root = path.replace(/\/anthropic$/i, "");
    append(`${root}/v1/models`);
    append(`${root}/models`);
  }

  return unique(candidates).map((candidate) =>
    resolveProviderBaseUrl({ protocol: input.protocol, baseUrl: candidate }),
  );
}

function normalizeModel(raw: unknown): DiscoveredModel | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string"
    ? value.id.trim()
    : typeof value.name === "string"
      ? value.name.trim()
      : "";
  if (!id || id.length > 200) return null;
  const ownedBy = typeof value.owned_by === "string"
    ? value.owned_by.slice(0, 120)
    : typeof value.provider === "string"
      ? value.provider.slice(0, 120)
      : null;
  const displayName = typeof value.display_name === "string"
    ? value.display_name.trim().slice(0, 200)
    : id;
  return { id, ownedBy, displayName };
}

export function parseProviderModelCatalog(payload: unknown): DiscoveredModel[] {
  if (!payload || typeof payload !== "object") {
    throw new AdminError("PROVIDER_MODEL_CATALOG_INVALID", "上游模型目录不是可识别的 JSON 对象", 502);
  }
  const record = payload as Record<string, unknown>;
  const source = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const byId = new Map<string, DiscoveredModel>();
  for (const raw of source.slice(0, MAX_MODELS + 1)) {
    const model = normalizeModel(raw);
    if (model) byId.set(model.id, model);
  }
  if (source.length > MAX_MODELS) {
    throw new AdminError("PROVIDER_MODEL_CATALOG_TOO_LARGE", `上游模型目录超过 ${MAX_MODELS} 条安全限制`, 502);
  }
  if (byId.size === 0) {
    throw new AdminError("PROVIDER_MODEL_CATALOG_EMPTY", "上游响应中没有可识别的模型 ID", 502);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function responseJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_CATALOG_BYTES) {
    throw new AdminError("PROVIDER_MODEL_CATALOG_TOO_LARGE", "上游模型目录响应过大", 502);
  }
  if (!response.body) return await response.json();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CATALOG_BYTES) {
      await reader.cancel();
      throw new AdminError("PROVIDER_MODEL_CATALOG_TOO_LARGE", "上游模型目录响应过大", 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AdminError("PROVIDER_MODEL_CATALOG_INVALID", "上游模型目录不是有效 JSON", 502);
  }
}

export async function fetchProviderModelCatalog(
  provider: Pick<ProviderDiscoveryRow, "protocol" | "base_url" | "config" | "timeout_ms">,
  credential: string,
  fetcher: typeof fetch = fetch,
) {
  if (provider.config?.modelCatalogMode === "manual") {
    throw new AdminError(
      "PROVIDER_MODEL_DISCOVERY_DISABLED",
      "该 Provider 配置为手工模型模式，不会调用 /models；请直接在模型注册表添加上游型号。",
      409,
    );
  }
  const authMode = provider.config?.authMode === "bearer" ? "bearer" : "x-api-key";
  const attempts: Array<{ endpoint: string; status: number | null }> = [];
  for (const endpoint of providerModelEndpointCandidates(provider)) {
    try {
      const response = await fetcher(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "user-agent": "Ink-Memory-Admin/Provider-Model-Discovery",
          ...(authMode === "bearer"
            ? { authorization: `Bearer ${credential}` }
            : { "x-api-key": credential }),
          ...(provider.protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(Math.max(provider.timeout_ms, 1_000), 15_000)),
      });
      attempts.push({ endpoint, status: response.status });
      if (!response.ok) continue;
      const models = parseProviderModelCatalog(await responseJson(response));
      return { endpoint, models, attempts };
    } catch (error) {
      if (error instanceof AdminError) throw error;
      attempts.push({ endpoint, status: null });
    }
  }
  throw new AdminError(
    "PROVIDER_MODEL_DISCOVERY_FAILED",
    "无法从 Provider 获取模型目录，请检查 Endpoint、Credential 与模型目录路径",
    502,
    { attempts },
  );
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "model";
}

export function buildDiscoveryDiff(
  providerCode: string,
  discovered: DiscoveredModel[],
  existing: Array<{ id: string; code: string; upstream_model: string }>,
  globallyUsedCodes: string[],
) {
  const byUpstream = new Map(existing.map((model) => [model.upstream_model, model]));
  const usedCodes = new Set(globallyUsedCodes);
  return discovered.map<DiscoveryDiffItem>((model) => {
    const current = byUpstream.get(model.id);
    if (current) {
      return { ...model, proposedCode: current.code, state: "existing", existingModelId: current.id };
    }
    const direct = slug(model.id);
    if (!usedCodes.has(direct)) {
      usedCodes.add(direct);
      return { ...model, proposedCode: direct, state: "new" };
    }
    const scoped = slug(`${providerCode}-${model.id}`);
    if (!usedCodes.has(scoped)) {
      usedCodes.add(scoped);
      return { ...model, proposedCode: scoped, state: "new" };
    }
    return {
      ...model,
      proposedCode: scoped,
      state: "conflict",
      conflictReason: "模型 alias 已被其他记录占用，需要人工修改后再单独创建",
    };
  });
}

async function loadProvider(client: PoolClient, providerId: string) {
  const { rows } = await client.query<ProviderDiscoveryRow>(
    `SELECT id, code, name, protocol, base_url, timeout_ms, config,
            api_key_ciphertext, api_key_iv, api_key_tag, updated_at
            , updated_at::text AS updated_at_token
     FROM ai_providers WHERE id = $1`,
    [providerId],
  );
  if (!rows[0]) {
    throw new AdminError("ADMIN_RESOURCE_ITEM_NOT_FOUND", "The requested provider does not exist", 404);
  }
  if (!rows[0].api_key_ciphertext || !rows[0].api_key_iv || !rows[0].api_key_tag) {
    throw new AdminError("PROVIDER_CREDENTIAL_UNAVAILABLE", "Provider 尚未保存可用 Credential", 409);
  }
  return rows[0];
}

async function createSnapshot(
  provider: ProviderDiscoveryRow,
  catalog: Awaited<ReturnType<typeof fetchProviderModelCatalog>>,
  identity: AdminIdentity,
  requestId: string,
  request: Request,
) {
  return await withPlatformTransaction(async (client) => {
    const existing = await client.query<{ id: string; code: string; upstream_model: string }>(
      "SELECT id, code, upstream_model FROM ai_models WHERE provider_id = $1 ORDER BY upstream_model",
      [provider.id],
    );
    const allCodes = await client.query<{ code: string }>("SELECT code FROM ai_models");
    const diff = buildDiscoveryDiff(provider.code, catalog.models, existing.rows, allCodes.rows.map((row) => row.code));
    const catalogHash = createHash("sha256").update(JSON.stringify(catalog.models)).digest("hex");
    const id = createPlatformId("discovery");
    const result = await client.query(
      `INSERT INTO ai_provider_discovery_snapshots (
         id, provider_id, provider_updated_at, endpoint, catalog_hash,
         models, diff, created_by, expires_at
       )
       SELECT $1, p.id, p.updated_at, $3, $4, $5::jsonb, $6::jsonb, $7, now() + interval '30 minutes'
       FROM ai_providers p WHERE p.id = $2 AND p.updated_at::text = $8
       RETURNING id, expires_at, created_at`,
      [id, provider.id, catalog.endpoint, catalogHash, JSON.stringify(catalog.models), JSON.stringify(diff), identity.id, provider.updated_at_token],
    );
    if (!result.rows[0]) {
      throw new AdminError("PROVIDER_CHANGED_DURING_DISCOVERY", "Provider 在同步期间已变化，请重新获取模型目录", 409);
    }
    await recordAdminAuditOnClient(client, {
      identity,
      action: "provider_model_discovery",
      resourceType: "providers",
      resourceId: provider.id,
      requestId,
      request,
      metadata: {
        snapshotId: id,
        endpoint: catalog.endpoint,
        catalogHash,
        discoveredCount: catalog.models.length,
        newCount: diff.filter((item) => item.state === "new").length,
        conflictCount: diff.filter((item) => item.state === "conflict").length,
      },
    });
    return {
      id,
      providerId: provider.id,
      endpoint: catalog.endpoint,
      catalogHash,
      models: catalog.models,
      diff,
      expiresAt: result.rows[0].expires_at as Date,
    };
  });
}

export async function handleProviderDiscovery(request: Request, providerId: string) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const provider = await withPlatformClient((client) => loadProvider(client, providerId));
    const credential = decryptCredential({
      ciphertext: provider.api_key_ciphertext!,
      iv: provider.api_key_iv!,
      tag: provider.api_key_tag!,
    });
    const catalog = await fetchProviderModelCatalog(provider, credential);
    const data = await createSnapshot(provider, catalog, identity, requestId, request);
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

async function loadSnapshot(client: PoolClient, snapshotId: string) {
  const { rows } = await client.query<DiscoverySnapshot>(
    `SELECT s.id, s.provider_id, p.code AS provider_code, p.name AS provider_name,
            CASE WHEN s.status = 'ready' AND s.expires_at <= now() THEN 'expired' ELSE s.status END AS status,
            s.endpoint, s.catalog_hash, s.models, s.diff, s.expires_at,
            s.applied_at, s.created_at
     FROM ai_provider_discovery_snapshots s
     JOIN ai_providers p ON p.id = s.provider_id
     WHERE s.id = $1`,
    [snapshotId],
  );
  if (!rows[0]) throw new AdminError("DISCOVERY_SNAPSHOT_NOT_FOUND", "模型同步快照不存在", 404);
  return rows[0];
}

export async function handleProviderDiscoverySnapshot(request: Request, snapshotId: string) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "providers.read");
    const data = await withPlatformClient((client) => loadSnapshot(client, snapshotId));
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

function selectedModelIds(body: unknown) {
  if (!body || typeof body !== "object" || !Array.isArray((body as { modelIds?: unknown }).modelIds)) {
    throw new AdminError("ADMIN_VALIDATION_ERROR", "modelIds must be an array", 400);
  }
  const ids = [...new Set((body as { modelIds: unknown[] }).modelIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0 || ids.length > MAX_MODELS) {
    throw new AdminError("ADMIN_VALIDATION_ERROR", "请选择至少一个且不超过 5000 个模型", 400);
  }
  return ids;
}

export async function handleProviderDiscoveryApply(request: Request, providerId: string) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "models.write");
    const body = await request.json().catch(() => null);
    const snapshotId = body && typeof body === "object" && typeof (body as { snapshotId?: unknown }).snapshotId === "string"
      ? (body as { snapshotId: string }).snapshotId
      : "";
    const modelIds = selectedModelIds(body);
    if (!snapshotId) throw new AdminError("ADMIN_VALIDATION_ERROR", "snapshotId is required", 400);

    const data = await withPlatformTransaction(async (client) => {
      const { rows } = await client.query<DiscoverySnapshot & { provider_unchanged: boolean }>(
        `SELECT s.*, (s.provider_updated_at IS NOT DISTINCT FROM p.updated_at) AS provider_unchanged
         FROM ai_provider_discovery_snapshots s
         JOIN ai_providers p ON p.id = s.provider_id
         WHERE s.id = $1 AND s.provider_id = $2
         FOR UPDATE OF s`,
        [snapshotId, providerId],
      );
      const snapshot = rows[0];
      if (!snapshot) throw new AdminError("DISCOVERY_SNAPSHOT_NOT_FOUND", "模型同步快照不存在", 404);
      if (snapshot.status !== "ready" || snapshot.expires_at <= new Date()) {
        throw new AdminError("DISCOVERY_SNAPSHOT_EXPIRED", "模型同步快照已应用或已过期，请重新同步", 409);
      }
      if (!snapshot.provider_unchanged) {
        throw new AdminError("PROVIDER_CHANGED_AFTER_DISCOVERY", "Provider 配置已变化，请重新获取模型目录", 409);
      }
      const diff = snapshot.diff as DiscoveryDiffItem[];
      const selected = diff.filter((item) => modelIds.includes(item.id));
      if (selected.length !== modelIds.length || selected.some((item) => item.state === "conflict")) {
        throw new AdminError("DISCOVERY_SELECTION_INVALID", "选择中包含不存在或冲突的模型", 409);
      }
      const created: string[] = [];
      const refreshed: string[] = [];
      for (const item of selected) {
        if (item.state === "existing" && item.existingModelId) {
          await client.query(
            `UPDATE ai_models SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
             WHERE id = $1`,
            [item.existingModelId, JSON.stringify({ discovery: { snapshotId, ownedBy: item.ownedBy, discoveredAt: new Date().toISOString() } })],
          );
          refreshed.push(item.existingModelId);
          continue;
        }
        const id = createPlatformId("model");
        await client.query(
          `INSERT INTO ai_models (
             id, provider_id, code, upstream_model, display_name, enabled, metadata
           ) VALUES ($1, $2, $3, $4, $5, false, $6::jsonb)`,
          [id, providerId, item.proposedCode, item.id, item.displayName, JSON.stringify({ discovery: { snapshotId, ownedBy: item.ownedBy, discoveredAt: new Date().toISOString() } })],
        );
        created.push(id);
      }
      await client.query(
        "UPDATE ai_provider_discovery_snapshots SET status = 'applied', applied_at = now() WHERE id = $1",
        [snapshotId],
      );
      await recordAdminAuditOnClient(client, {
        identity,
        action: "provider_model_discovery_apply",
        resourceType: "providers",
        resourceId: providerId,
        requestId,
        request,
        metadata: { snapshotId, selectedCount: selected.length, created, refreshed },
      });
      return { snapshotId, created, refreshed, selectedCount: selected.length };
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
