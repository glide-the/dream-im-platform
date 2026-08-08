import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_MATCHES = 10_000;

type ModelsDevEntry = {
  key: string;
  providerId: string;
  providerName: string;
  modelId: string;
  normalizedId: string;
  modelName: string;
  releaseDate: string;
  inputMicrousd: string;
  outputMicrousd: string;
  cacheReadMicrousd: string;
  cacheWriteMicrousd: string;
};

export type PricingSyncMatch = ModelsDevEntry & {
  localModelId: string;
  localModelCode: string;
  upstreamModel: string;
  providerCode: string;
  match: "exact" | "normalized" | "ambiguous" | "unmatched";
  candidates?: string[];
};

type LocalModel = {
  id: string;
  code: string;
  upstream_model: string;
  provider_code: string;
  provider_name: string;
};

type PricingSnapshot = {
  id: string;
  provider_id: string | null;
  catalog_ref: string;
  catalog_version: string;
  catalog_hash: string;
  status: "ready" | "applied" | "expired";
  matches: PricingSyncMatch[];
  expires_at: Date;
  applied_at: Date | null;
  created_at: Date;
};

const NON_TEXT_MARKERS = [
  "audio", "deprecated", "embedding", "image", "moderation", "realtime",
  "transcribe", "tts", "video",
];

export function normalizeModelIdForPricing(modelId: string) {
  const afterSlash = modelId.slice(modelId.lastIndexOf("/") + 1);
  const beforeColon = afterSlash.split(":")[0] ?? "";
  let normalized = beforeColon.trim().replaceAll("@", "-").toLowerCase();
  if (normalized.endsWith("[1m]")) normalized = normalized.slice(0, -4).trim();
  return normalized;
}

export function decimalUsdToMicrousd(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return "0";
  const raw = String(value).trim().toLowerCase();
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(raw);
  if (!match) throw new AdminError("MODELS_DEV_PRICE_INVALID", "models.dev 返回了无效价格", 502);
  const whole = match[1];
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || exponent < -30 || exponent > 30) {
    throw new AdminError("MODELS_DEV_PRICE_INVALID", "models.dev 返回的价格指数超出安全范围", 502);
  }
  const digits = BigInt(`${whole}${fraction}`);
  const power = exponent + 6 - fraction.length;
  if (power >= 0) return (digits * 10n ** BigInt(power)).toString();
  const divisor = 10n ** BigInt(-power);
  const quotient = digits / divisor;
  const remainder = digits % divisor;
  return (quotient + (remainder * 2n >= divisor ? 1n : 0n)).toString();
}

function isTextModel(modelId: string, model: Record<string, unknown>) {
  if (String(model.status ?? "").toLowerCase() === "deprecated") return false;
  const modalities = model.modalities && typeof model.modalities === "object"
    ? (model.modalities as Record<string, unknown>).output
    : undefined;
  if (Array.isArray(modalities)) {
    const output = modalities.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
    if (output.length > 0 && (!output.includes("text") || output.some((item) => ["audio", "image", "video"].includes(item)))) return false;
  }
  const searchable = `${modelId} ${String(model.name ?? "")}`.toLowerCase();
  return !NON_TEXT_MARKERS.some((marker) => searchable.includes(marker));
}

export function flattenModelsDevCatalog(payload: unknown): ModelsDevEntry[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminError("MODELS_DEV_CATALOG_INVALID", "models.dev 目录格式无效", 502);
  }
  const entries: ModelsDevEntry[] = [];
  for (const [providerId, providerValue] of Object.entries(payload as Record<string, unknown>)) {
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) continue;
    const provider = providerValue as Record<string, unknown>;
    const providerName = typeof provider.name === "string" ? provider.name : providerId;
    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    for (const [modelId, modelValue] of Object.entries(models as Record<string, unknown>)) {
      if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) continue;
      const model = modelValue as Record<string, unknown>;
      if (!isTextModel(modelId, model)) continue;
      const cost = model.cost && typeof model.cost === "object"
        ? model.cost as Record<string, unknown>
        : {};
      if (cost.input === undefined && cost.output === undefined) continue;
      const normalizedId = normalizeModelIdForPricing(modelId);
      if (!normalizedId) continue;
      entries.push({
        key: `${providerId}/${modelId}`,
        providerId,
        providerName,
        modelId,
        normalizedId,
        modelName: typeof model.name === "string" ? model.name : modelId,
        releaseDate: typeof model.release_date === "string" ? model.release_date : "",
        inputMicrousd: decimalUsdToMicrousd(cost.input ?? 0),
        outputMicrousd: decimalUsdToMicrousd(cost.output ?? 0),
        cacheReadMicrousd: decimalUsdToMicrousd(cost.cache_read ?? 0),
        cacheWriteMicrousd: decimalUsdToMicrousd(cost.cache_write ?? 0),
      });
      if (entries.length > MAX_MATCHES) {
        throw new AdminError("MODELS_DEV_CATALOG_TOO_LARGE", "models.dev 可计费模型超过安全限制", 502);
      }
    }
  }
  return entries.sort((left, right) => right.releaseDate.localeCompare(left.releaseDate) || left.modelName.localeCompare(right.modelName));
}

function providerMatches(local: LocalModel, remote: ModelsDevEntry) {
  const localProvider = `${local.provider_code} ${local.provider_name}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const remoteProvider = `${remote.providerId} ${remote.providerName}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return localProvider.includes(remote.providerId.toLowerCase().replace(/[^a-z0-9]+/g, "")) || remoteProvider.includes(local.provider_code.toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

export function matchModelsDevPricing(localModels: LocalModel[], entries: ModelsDevEntry[]) {
  return localModels.map<PricingSyncMatch>((local) => {
    const exactAll = entries.filter((entry) => entry.modelId === local.upstream_model);
    const exactPreferred = exactAll.filter((entry) => providerMatches(local, entry));
    const exact = exactPreferred.length === 1 ? exactPreferred : exactAll;
    const normalizedId = normalizeModelIdForPricing(local.upstream_model);
    const normalizedAll = entries.filter((entry) => entry.normalizedId === normalizedId);
    const normalizedPreferred = normalizedAll.filter((entry) => providerMatches(local, entry));
    const normalized = normalizedPreferred.length === 1 ? normalizedPreferred : normalizedAll;
    const candidates = exact.length > 0 ? exact : normalized;
    const selected = candidates[0];
    if (!selected) {
      return {
        key: "", providerId: "", providerName: "", modelId: "", normalizedId,
        modelName: "", releaseDate: "", inputMicrousd: "0", outputMicrousd: "0",
        cacheReadMicrousd: "0", cacheWriteMicrousd: "0", localModelId: local.id,
        localModelCode: local.code, upstreamModel: local.upstream_model, providerCode: local.provider_code,
        match: "unmatched",
      };
    }
    return {
      ...selected,
      localModelId: local.id,
      localModelCode: local.code,
      upstreamModel: local.upstream_model,
      providerCode: local.provider_code,
      match: candidates.length > 1 ? "ambiguous" : exact.length > 0 ? "exact" : "normalized",
      ...(candidates.length > 1 ? { candidates: candidates.slice(0, 20).map((entry) => entry.key) } : {}),
    };
  });
}

async function fetchCatalog(fetcher: typeof fetch = fetch) {
  const response = await fetcher(MODELS_DEV_API_URL, {
    headers: { accept: "application/json", "accept-encoding": "identity", "user-agent": "Ink-Memory-Admin/Pricing-Sync" },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AdminError("MODELS_DEV_FETCH_FAILED", `models.dev 返回 HTTP ${response.status}`, 502);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_CATALOG_BYTES) throw new AdminError("MODELS_DEV_CATALOG_TOO_LARGE", "models.dev 目录响应过大", 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CATALOG_BYTES) throw new AdminError("MODELS_DEV_CATALOG_TOO_LARGE", "models.dev 目录响应过大", 502);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AdminError("MODELS_DEV_CATALOG_INVALID", "models.dev 目录不是有效 JSON", 502);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { entries: flattenModelsDevCatalog(payload), hash, version: response.headers.get("etag") ?? hash.slice(0, 16) };
}

async function loadLocalModels(client: PoolClient, providerId?: string) {
  const { rows } = await client.query<LocalModel>(
    `SELECT m.id, m.code, m.upstream_model, p.code AS provider_code, p.name AS provider_name
     FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id
     WHERE ($1::text IS NULL OR m.provider_id = $1)
     ORDER BY p.code, m.code`,
    [providerId ?? null],
  );
  return rows;
}

export async function handlePricingSyncCreate(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "pricing.write");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const providerId = typeof body.providerId === "string" && body.providerId ? body.providerId : undefined;
    const force = body.force === true;
    if (!force) {
      const recent = await withPlatformClient(async (client) => {
        const { rows } = await client.query(
          `SELECT id FROM ai_pricing_sync_snapshots
           WHERE provider_id IS NOT DISTINCT FROM $1::text
             AND created_at >= now() - interval '6 hours'
             AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1`,
          [providerId ?? null],
        );
        return rows[0]?.id as string | undefined;
      });
      if (recent) {
        return Response.json({ data: { id: recent, reused: true, throttledByHours: 6 } }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
      }
    }
    const [catalog, localModels] = await Promise.all([
      fetchCatalog(),
      withPlatformClient((client) => loadLocalModels(client, providerId)),
    ]);
    const matches = matchModelsDevPricing(localModels, catalog.entries);
    const id = createPlatformId("pricing_sync");
    const data = await withPlatformTransaction(async (client) => {
      if (providerId) {
        const provider = await client.query("SELECT id FROM ai_providers WHERE id = $1", [providerId]);
        if (!provider.rows[0]) throw new AdminError("ADMIN_RESOURCE_ITEM_NOT_FOUND", "Provider 不存在", 404);
      }
      const { rows } = await client.query(
        `INSERT INTO ai_pricing_sync_snapshots (
           id, provider_id, catalog_ref, catalog_version, catalog_hash,
           matches, created_by, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now() + interval '30 minutes')
         RETURNING expires_at, created_at`,
        [id, providerId ?? null, MODELS_DEV_API_URL, catalog.version, catalog.hash, JSON.stringify(matches), identity.id],
      );
      await recordAdminAuditOnClient(client, {
        identity, action: "models_dev_pricing_discovery", resourceType: "pricing", resourceId: id,
        requestId, request, metadata: {
          providerId: providerId ?? null, catalogHash: catalog.hash, localModelCount: localModels.length,
          exactCount: matches.filter((item) => item.match === "exact").length,
          normalizedCount: matches.filter((item) => item.match === "normalized").length,
          ambiguousCount: matches.filter((item) => item.match === "ambiguous").length,
          unmatchedCount: matches.filter((item) => item.match === "unmatched").length,
        },
      });
      return { id, providerId: providerId ?? null, catalogVersion: catalog.version, catalogHash: catalog.hash, matches, ...rows[0] };
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

async function loadSnapshot(client: PoolClient, snapshotId: string, lock = false) {
  const { rows } = await client.query<PricingSnapshot>(
    `SELECT id, provider_id, catalog_ref, catalog_version, catalog_hash,
            CASE WHEN status = 'ready' AND expires_at <= now() THEN 'expired' ELSE status END AS status,
            matches, expires_at, applied_at, created_at
     FROM ai_pricing_sync_snapshots WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [snapshotId],
  );
  if (!rows[0]) throw new AdminError("PRICING_SYNC_NOT_FOUND", "价格同步快照不存在", 404);
  return rows[0];
}

export async function handlePricingSyncSnapshot(request: Request, snapshotId: string) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "pricing.read");
    const data = await withPlatformClient((client) => loadSnapshot(client, snapshotId));
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

function applyInput(body: unknown) {
  if (!body || typeof body !== "object") throw new AdminError("ADMIN_VALIDATION_ERROR", "请求体无效", 400);
  const value = body as Record<string, unknown>;
  const modelIds = Array.isArray(value.modelIds)
    ? [...new Set(value.modelIds.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : [];
  if (modelIds.length === 0 || modelIds.length > MAX_MATCHES) throw new AdminError("ADMIN_VALIDATION_ERROR", "请选择要应用价格的模型", 400);
  const effectiveFrom = typeof value.effectiveFrom === "string" ? new Date(value.effectiveFrom) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) throw new AdminError("ADMIN_VALIDATION_ERROR", "effectiveFrom 必须是有效日期时间", 400);
  return { modelIds, effectiveFrom };
}

function samePrice(row: Record<string, unknown>, match: PricingSyncMatch) {
  return String(row.input_price_microusd_per_million) === match.inputMicrousd
    && String(row.output_price_microusd_per_million) === match.outputMicrousd
    && String(row.cache_read_price_microusd_per_million) === match.cacheReadMicrousd
    && String(row.cache_write_price_microusd_per_million) === match.cacheWriteMicrousd;
}

export async function handlePricingSyncApply(request: Request, snapshotId: string) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "pricing.write");
    const input = applyInput(await request.json().catch(() => null));
    const data = await withPlatformTransaction(async (client) => {
      const snapshot = await loadSnapshot(client, snapshotId, true);
      if (snapshot.status !== "ready" || snapshot.expires_at <= new Date()) {
        throw new AdminError("PRICING_SYNC_EXPIRED", "价格同步快照已应用或过期，请重新同步", 409);
      }
      const selected = snapshot.matches.filter((match) => input.modelIds.includes(match.localModelId));
      if (selected.length !== input.modelIds.length || selected.some((match) => !["exact", "normalized"].includes(match.match))) {
        throw new AdminError("PRICING_SYNC_SELECTION_INVALID", "只能应用唯一匹配的模型价格", 409);
      }
      const created: string[] = [];
      const unchanged: string[] = [];
      for (const match of selected) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${match.localModelId}:default`],
        );
        const { rows } = await client.query<Record<string, unknown>>(
          `SELECT * FROM ai_pricing_rules
           WHERE model_id = $1 AND user_tier = 'default' AND status = 'active' AND effective_to IS NULL
           ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
          [match.localModelId],
        );
        const current = rows[0];
        if (current && samePrice(current, match)) {
          unchanged.push(String(current.id));
          continue;
        }
        if (current) {
          const currentFrom = new Date(String(current.effective_from));
          if (input.effectiveFrom <= currentFrom) {
            throw new AdminError("PRICING_EFFECTIVE_TIME_CONFLICT", `模型 ${match.localModelCode} 的生效时间必须晚于当前价格版本`, 409);
          }
          await client.query("UPDATE ai_pricing_rules SET effective_to = $2, updated_at = now() WHERE id = $1", [current.id, input.effectiveFrom]);
        }
        const id = createPlatformId("pricing");
        await client.query(
          `INSERT INTO ai_pricing_rules (
             id, model_id, user_tier,
             input_price_microusd_per_million, output_price_microusd_per_million,
             cache_read_price_microusd_per_million, cache_write_price_microusd_per_million,
             markup_bps, discount_bps, status, source, source_ref, source_version,
             source_metadata, effective_from
           ) VALUES ($1, $2, 'default', $3, $4, $5, $6, $7, $8, 'active',
                     'models.dev', $9, $10, $11::jsonb, $12)`,
          [
            id, match.localModelId, match.inputMicrousd, match.outputMicrousd,
            match.cacheReadMicrousd, match.cacheWriteMicrousd,
            Number(current?.markup_bps ?? 0), Number(current?.discount_bps ?? 0),
            match.key, snapshot.catalog_version,
            JSON.stringify({ snapshotId, providerId: match.providerId, modelId: match.modelId, catalogHash: snapshot.catalog_hash }),
            input.effectiveFrom,
          ],
        );
        created.push(id);
      }
      await client.query("UPDATE ai_pricing_sync_snapshots SET status = 'applied', applied_at = now() WHERE id = $1", [snapshotId]);
      await recordAdminAuditOnClient(client, {
        identity, action: "models_dev_pricing_apply", resourceType: "pricing", resourceId: snapshotId,
        requestId, request, metadata: { selectedCount: selected.length, created, unchanged, effectiveFrom: input.effectiveFrom.toISOString() },
      });
      return { snapshotId, selectedCount: selected.length, created, unchanged, effectiveFrom: input.effectiveFrom.toISOString() };
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
