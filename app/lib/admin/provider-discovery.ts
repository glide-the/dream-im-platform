// [Input] Authenticated Provider discovery requests, static or Provider-owned managed credentials, and bounded upstream catalogs.
// [Output] Generation-fenced, secret-safe model discovery snapshots and deterministic apply diffs.
// [Pos] Admin Provider model-catalog domain; product protocol calls remain in app/lib/providers and credential lifecycle in the broker.
// [Sync] 2026-09-04: add account-scoped Codex, xAI, and Copilot catalogs with advisory-lock snapshot idempotency.

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import type { AiProviderProtocol } from "../billing/types";
import { resolveProviderAuthMode } from "../gateway/provider-auth";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { resolveManagedProviderCatalogAccess } from "../gateway/managed-provider-credentials";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { decryptCredential } from "../security/credential-encryption";
import type { ProviderProductKind } from "../providers";
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
  base_url: string | null;
  adapter_kind: "generic" | ProviderProductKind;
  active_credential_kind: "static_api_key" | "managed_oauth" | "none";
  auth_epoch: number;
  managed_credential_id: string | null;
  managed_account_auth_epoch: number | null;
  managed_credential_revision: number | null;
  registration_fingerprint: string | null;
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
  vendor: string | null;
  upstreamDialect: "openai_responses" | "openai_chat" | null;
  gatewayCompatible: boolean;
  capabilities: readonly string[];
};

export type DiscoveryDiffItem = DiscoveredModel & {
  proposedCode: string;
  state: "new" | "existing" | "conflict" | "unsupported";
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

export type ManagedDiscoveryGeneration = Readonly<{
  adapterKind: ProviderProductKind;
  authEpoch: number;
  accountId: string;
  accountAuthEpoch: number;
  credentialRevision: number;
  registrationFingerprint: string;
}>;

type ProviderCatalog = Readonly<{
  endpoint: string;
  models: readonly DiscoveredModel[];
  attempts?: readonly { endpoint: string; status: number | null }[];
  generation?: ManagedDiscoveryGeneration;
}>;

export type ProviderDiscoveryReceipt = Readonly<{
  id: string;
  providerId: string;
  endpoint: string;
  catalogHash: string;
  models: readonly DiscoveredModel[];
  diff: readonly DiscoveryDiffItem[];
  expiresAt: Date;
  reused: boolean;
  discoveredCount: number;
  newCount: number;
  conflictCount: number;
  unsupportedCount: number;
}>;

const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 5_000;
const MANAGED_DISCOVERY_CONTRACT_VERSION = 1;

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

export function managedCatalogHash(
  generation: ManagedDiscoveryGeneration,
  models: readonly DiscoveredModel[],
) {
  return createHash("sha256").update(JSON.stringify({
    contractVersion: MANAGED_DISCOVERY_CONTRACT_VERSION,
    generation: {
      adapterKind: generation.adapterKind,
      authEpoch: generation.authEpoch,
      accountId: generation.accountId,
      accountAuthEpoch: generation.accountAuthEpoch,
      credentialRevision: generation.credentialRevision,
      registrationFingerprint: generation.registrationFingerprint,
    },
    // PostgreSQL jsonb does not preserve object-key insertion order. Rebuild the
    // public projection explicitly so a snapshot round-trip cannot change its hash.
    models: models.map((model) => ({
      id: model.id,
      ownedBy: model.ownedBy,
      displayName: model.displayName,
      vendor: model.vendor,
      upstreamDialect: model.upstreamDialect,
      gatewayCompatible: model.gatewayCompatible,
      capabilities: [...model.capabilities],
    })),
  })).digest("hex");
}

function catalogHash(catalog: ProviderCatalog) {
  return catalog.generation
    ? managedCatalogHash(catalog.generation, catalog.models)
    : createHash("sha256").update(JSON.stringify(catalog.models)).digest("hex");
}

export function providerModelEndpointCandidates(
  input: Pick<ProviderDiscoveryRow, "protocol" | "config"> & { base_url: string },
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
  return {
    id,
    ownedBy,
    displayName,
    vendor: ownedBy,
    upstreamDialect: null,
    gatewayCompatible: true,
    capabilities: [],
  };
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
  provider: Pick<ProviderDiscoveryRow, "protocol" | "config" | "timeout_ms"> & { base_url: string },
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
  const authMode = resolveProviderAuthMode({
    protocol: provider.protocol,
    config: provider.config ?? {},
  });
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
    if (!model.gatewayCompatible) {
      return {
        ...model,
        proposedCode: current?.code ?? slug(`${providerCode}-${model.id}`),
        state: "unsupported",
        ...(current ? { existingModelId: current.id } : {}),
        conflictReason: "该账号可见此模型，但当前 Gateway 尚未实现它要求的上游协议；本轮只展示，不允许应用。",
      };
    }
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
    `SELECT provider.id, provider.code, provider.name, provider.protocol,
            provider.base_url, provider.adapter_kind, provider.timeout_ms,
            provider.config, provider.api_key_ciphertext, provider.api_key_iv,
            provider.api_key_tag, provider.active_credential_kind,
            provider.auth_epoch, provider.managed_credential_id,
            managed.auth_epoch AS managed_account_auth_epoch,
            managed.revision AS managed_credential_revision,
            managed.registration_fingerprint,
            provider.updated_at, provider.updated_at::text AS updated_at_token
       FROM ai_providers AS provider
       LEFT JOIN ai_provider_managed_credentials AS managed
         ON managed.provider_id = provider.id
        AND managed.adapter_kind = provider.adapter_kind
        AND managed.id = provider.managed_credential_id
      WHERE provider.id = $1 AND provider.status <> 'deleted'`,
    [providerId],
  );
  if (!rows[0]) {
    throw new AdminError("ADMIN_RESOURCE_ITEM_NOT_FOUND", "The requested provider does not exist", 404);
  }
  const provider = rows[0];
  if (provider.adapter_kind === "generic") {
    if (!provider.base_url) {
      throw new AdminError("PROVIDER_ENDPOINT_UNAVAILABLE", "Generic Provider 缺少 Endpoint", 409);
    }
    if (!provider.api_key_ciphertext || !provider.api_key_iv || !provider.api_key_tag) {
      throw new AdminError("PROVIDER_CREDENTIAL_UNAVAILABLE", "Provider 尚未保存可用 Credential", 409);
    }
    return provider as ProviderDiscoveryRow & { adapter_kind: "generic"; base_url: string };
  }
  if (
    provider.active_credential_kind !== "managed_oauth"
    || !provider.managed_credential_id
    || !provider.managed_account_auth_epoch
    || !provider.managed_credential_revision
    || !provider.registration_fingerprint
  ) {
    throw new AdminError(
      "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE",
      "请先连接可用的产品账号，再同步模型目录。",
      409,
    );
  }
  return provider as ProviderDiscoveryRow & {
    adapter_kind: ProviderProductKind;
    managed_credential_id: string;
    managed_account_auth_epoch: number;
    managed_credential_revision: number;
    registration_fingerprint: string;
  };
}

async function createSnapshot(
  provider: ProviderDiscoveryRow,
  catalog: ProviderCatalog,
  identity: AdminIdentity,
  requestId: string,
  request: Request,
): Promise<ProviderDiscoveryReceipt> {
  return await withPlatformTransaction(async (client) => {
    const computedCatalogHash = catalogHash(catalog);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`provider-model-discovery:${provider.id}:${computedCatalogHash}`],
    );
    let providerUpdatedAtToken = provider.updated_at_token;
    if (catalog.generation) {
      const generation = catalog.generation;
      const current = await client.query<{ updated_at_token: string }>(
        `SELECT provider.updated_at::text AS updated_at_token
           FROM ai_providers AS provider
           JOIN ai_provider_managed_credentials AS managed
             ON managed.provider_id = provider.id
            AND managed.adapter_kind = provider.adapter_kind
            AND managed.id = provider.managed_credential_id
          WHERE provider.id = $1 AND provider.status <> 'deleted'
            AND provider.adapter_kind = $2
            AND provider.active_credential_kind = 'managed_oauth'
            AND provider.auth_epoch = $3
            AND managed.id = $4 AND managed.status = 'connected'
            AND managed.auth_epoch = $5 AND managed.revision = $6
            AND managed.registration_fingerprint = $7`,
        [
          provider.id,
          generation.adapterKind,
          generation.authEpoch,
          generation.accountId,
          generation.accountAuthEpoch,
          generation.credentialRevision,
          generation.registrationFingerprint,
        ],
      );
      if (!current.rows[0]) {
        throw new AdminError(
          "PROVIDER_CHANGED_DURING_DISCOVERY",
          "账号或凭据在同步期间已变化，请重新获取模型目录。",
          409,
        );
      }
      providerUpdatedAtToken = current.rows[0].updated_at_token;
    }

    const reusable = await client.query<{
      id: string;
      expires_at: Date;
      created_at: Date;
      diff: DiscoveryDiffItem[];
    }>(
      `SELECT id, expires_at, created_at, diff
         FROM ai_provider_discovery_snapshots
        WHERE provider_id = $1 AND catalog_hash = $2
          AND provider_updated_at::text = $3
          AND status = 'ready' AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1`,
      [provider.id, computedCatalogHash, providerUpdatedAtToken],
    );
    if (reusable.rows[0]) {
      const diff = reusable.rows[0].diff;
      return {
        id: reusable.rows[0].id,
        providerId: provider.id,
        endpoint: catalog.endpoint,
        catalogHash: computedCatalogHash,
        models: catalog.models,
        diff,
        expiresAt: reusable.rows[0].expires_at,
        reused: true,
        discoveredCount: catalog.models.length,
        newCount: diff.filter((item) => item.state === "new").length,
        conflictCount: diff.filter((item) => item.state === "conflict").length,
        unsupportedCount: diff.filter((item) => item.state === "unsupported").length,
      };
    }

    const existing = await client.query<{ id: string; code: string; upstream_model: string }>(
      "SELECT id, code, upstream_model FROM ai_models WHERE provider_id = $1 ORDER BY upstream_model",
      [provider.id],
    );
    const allCodes = await client.query<{ code: string }>("SELECT code FROM ai_models");
    const diff = buildDiscoveryDiff(provider.code, [...catalog.models], existing.rows, allCodes.rows.map((row) => row.code));
    const id = createPlatformId("discovery");
    const result = await client.query(
      `INSERT INTO ai_provider_discovery_snapshots (
         id, provider_id, provider_updated_at, endpoint, catalog_hash,
         models, diff, created_by, expires_at
       )
       SELECT $1, p.id, p.updated_at, $3, $4, $5::jsonb, $6::jsonb, $7, now() + interval '30 minutes'
       FROM ai_providers p WHERE p.id = $2 AND p.updated_at::text = $8
       RETURNING id, expires_at, created_at`,
      [id, provider.id, catalog.endpoint, computedCatalogHash, JSON.stringify(catalog.models), JSON.stringify(diff), identity.id, providerUpdatedAtToken],
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
        catalogHash: computedCatalogHash,
        discoveredCount: catalog.models.length,
        newCount: diff.filter((item) => item.state === "new").length,
        conflictCount: diff.filter((item) => item.state === "conflict").length,
        unsupportedCount: diff.filter((item) => item.state === "unsupported").length,
        managedGeneration: Boolean(catalog.generation),
      },
    });
    return {
      id,
      providerId: provider.id,
      endpoint: catalog.endpoint,
      catalogHash: computedCatalogHash,
      models: catalog.models,
      diff,
      expiresAt: result.rows[0].expires_at as Date,
      reused: false,
      discoveredCount: catalog.models.length,
      newCount: diff.filter((item) => item.state === "new").length,
      conflictCount: diff.filter((item) => item.state === "conflict").length,
      unsupportedCount: diff.filter((item) => item.state === "unsupported").length,
    };
  });
}

async function fetchCatalogForProvider(provider: ProviderDiscoveryRow): Promise<ProviderCatalog> {
  if (provider.adapter_kind === "generic") {
    const credential = decryptCredential({
      ciphertext: provider.api_key_ciphertext!,
      iv: provider.api_key_iv!,
      tag: provider.api_key_tag!,
    });
    return await fetchProviderModelCatalog(
      provider as ProviderDiscoveryRow & { adapter_kind: "generic"; base_url: string },
      credential,
    );
  }

  try {
    const access = await resolveManagedProviderCatalogAccess({
      providerId: provider.id,
      adapterKind: provider.adapter_kind,
      authEpoch: provider.auth_epoch,
      managedAccountId: provider.managed_credential_id!,
      managedAccountAuthEpoch: provider.managed_account_auth_epoch!,
      credentialRevision: provider.managed_credential_revision!,
    });
    if (access.models.length > MAX_MODELS) {
      throw new AdminError(
        "PROVIDER_MODEL_CATALOG_TOO_LARGE",
        `上游模型目录超过 ${MAX_MODELS} 条安全限制`,
        502,
      );
    }
    return {
      endpoint: access.endpoint,
      models: access.models.map((model) => ({
        id: model.id.trim().slice(0, 200),
        displayName: model.displayName.trim().slice(0, 200) || model.id.trim().slice(0, 200),
        ownedBy: model.vendor.trim().slice(0, 120) || null,
        vendor: model.vendor.trim().slice(0, 120) || null,
        upstreamDialect: model.upstreamDialect,
        gatewayCompatible: model.gatewayCompatible,
        capabilities: model.capabilities
          .map((capability) => capability.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 50),
      })).filter((model) => model.id.length > 0),
      generation: {
        adapterKind: access.adapterKind,
        authEpoch: access.authEpoch,
        accountId: access.accountId,
        accountAuthEpoch: access.accountAuthEpoch,
        credentialRevision: access.credentialRevision,
        registrationFingerprint: access.registrationFingerprint,
      },
    };
  } catch (error) {
    const value = error as { code?: unknown; message?: unknown; retryable?: unknown };
    throw new AdminError(
      typeof value.code === "string" ? value.code : "PROVIDER_MODEL_DISCOVERY_FAILED",
      typeof value.message === "string" ? value.message : "无法从产品账号获取模型目录",
      value.retryable === true ? 503 : 409,
    );
  }
}

export async function discoverProviderModels(input: {
  providerId: string;
  identity: AdminIdentity;
  requestId: string;
  request: Request;
}) {
  const provider = await withPlatformClient((client) => loadProvider(client, input.providerId));
  const catalog = await fetchCatalogForProvider(provider);
  return await createSnapshot(provider, catalog, input.identity, input.requestId, input.request);
}

export async function handleProviderDiscovery(request: Request, providerId: string) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const data = await discoverProviderModels({ providerId, identity, requestId, request });
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
      const { rows } = await client.query<DiscoverySnapshot & {
        provider_unchanged: boolean;
        provider_adapter_kind: "generic" | ProviderProductKind;
        provider_auth_epoch: number;
        managed_credential_id: string | null;
        managed_account_auth_epoch: number | null;
        managed_credential_revision: number | null;
        registration_fingerprint: string | null;
      }>(
        `SELECT s.*, (s.provider_updated_at IS NOT DISTINCT FROM p.updated_at) AS provider_unchanged,
                p.adapter_kind AS provider_adapter_kind,
                p.auth_epoch AS provider_auth_epoch,
                p.managed_credential_id,
                managed.auth_epoch AS managed_account_auth_epoch,
                managed.revision AS managed_credential_revision,
                managed.registration_fingerprint
         FROM ai_provider_discovery_snapshots s
         JOIN ai_providers p ON p.id = s.provider_id
         LEFT JOIN ai_provider_managed_credentials AS managed
           ON managed.provider_id = p.id
          AND managed.adapter_kind = p.adapter_kind
          AND managed.id = p.managed_credential_id
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
      if (snapshot.provider_adapter_kind !== "generic") {
        if (
          !snapshot.managed_credential_id
          || !snapshot.managed_account_auth_epoch
          || !snapshot.managed_credential_revision
          || !snapshot.registration_fingerprint
          || managedCatalogHash({
            adapterKind: snapshot.provider_adapter_kind,
            authEpoch: snapshot.provider_auth_epoch,
            accountId: snapshot.managed_credential_id,
            accountAuthEpoch: snapshot.managed_account_auth_epoch,
            credentialRevision: snapshot.managed_credential_revision,
            registrationFingerprint: snapshot.registration_fingerprint,
          }, snapshot.models) !== snapshot.catalog_hash
        ) {
          throw new AdminError(
            "PROVIDER_DISCOVERY_GENERATION_STALE",
            "账号或凭据已变化，请重新获取模型目录后再应用。",
            409,
          );
        }
      }
      const diff = snapshot.diff as DiscoveryDiffItem[];
      const selected = diff.filter((item) => modelIds.includes(item.id));
      if (
        selected.length !== modelIds.length
        || selected.some((item) => item.state === "conflict" || item.state === "unsupported")
      ) {
        throw new AdminError("DISCOVERY_SELECTION_INVALID", "选择中包含不存在、冲突或当前 Gateway 不兼容的模型", 409);
      }
      const created: string[] = [];
      const refreshed: string[] = [];
      for (const item of selected) {
        if (item.state === "existing" && item.existingModelId) {
          await client.query(
            `UPDATE ai_models SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
             WHERE id = $1`,
            [item.existingModelId, JSON.stringify({
              discovery: {
                snapshotId,
                ownedBy: item.ownedBy,
                vendor: item.vendor,
                upstreamDialect: item.upstreamDialect,
                gatewayCompatible: item.gatewayCompatible,
                capabilities: item.capabilities,
                discoveredAt: new Date().toISOString(),
              },
            })],
          );
          refreshed.push(item.existingModelId);
          continue;
        }
        const id = createPlatformId("model");
        await client.query(
          `INSERT INTO ai_models (
             id, provider_id, code, upstream_model, display_name, enabled, metadata
           ) VALUES ($1, $2, $3, $4, $5, false, $6::jsonb)`,
          [id, providerId, item.proposedCode, item.id, item.displayName, JSON.stringify({
            discovery: {
              snapshotId,
              ownedBy: item.ownedBy,
              vendor: item.vendor,
              upstreamDialect: item.upstreamDialect,
              gatewayCompatible: item.gatewayCompatible,
              capabilities: item.capabilities,
              discoveredAt: new Date().toISOString(),
            },
          })],
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
