// [Input] Provider ID, Admin read authority, encrypted Provider-owned credentials and named usage policy.
// [Output] Safe cached/coalesced upstream metrics; old success is visibly stale after refresh failure.
// [Pos] Admin upstream usage orchestration; no upstream raw body or credential leaves this boundary.
import { createHash } from "node:crypto";
import { z } from "zod";
import { withPlatformClient } from "../platform-db";
import { decryptCredential } from "../security/credential-encryption";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { resolveManagedProviderUsageAccess } from "../gateway/managed-provider-credentials";
import { ProviderProtocolError } from "../providers/errors";
import { GatewayError } from "../gateway/errors";
import { queryUpstreamUsage, type UpstreamUsage } from "../providers/upstream-usage";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, assertAdminMutationOrigin, requireAdminRequest } from "./guard";

type UsageProvider = { id: string; status: string; protocol: "anthropic" | "openai"; base_url: string | null;
  adapter_kind: "generic" | "codex" | "xai" | "github_copilot"; config: Record<string, unknown> | null;
  timeout_ms: number; auth_revision: number; auth_epoch: number; managed_credential_id: string | null;
  credential_revision: number | null; account_auth_epoch: number | null;
  api_key_ciphertext: string | null; api_key_iv: string | null; api_key_tag: string | null };
const cache = new Map<string, { key: string; success?: UpstreamUsage; pending?: Promise<UpstreamUsage> }>();
function ttlSeconds() {
  const value = Number(process.env.PROVIDER_USAGE_CACHE_TTL_SECONDS ?? "60");
  if (!Number.isSafeInteger(value) || value < 0) throw new AdminError("PROVIDER_USAGE_POLICY_INVALID", "用量缓存策略无效", 503);
  return value;
}
export async function coalescedProviderUsage(providerId: string, key: string, load: () => Promise<UpstreamUsage>) {
  let entry = cache.get(providerId);
  if (!entry || entry.key !== key) { entry = { key }; cache.set(providerId, entry); }
  if (entry.pending) return entry.pending;
  if (entry.success && Date.parse(entry.success.expiresAt) > Date.now()) return entry.success;
  const current = entry;
  current.pending = load().then((result) => {
    if (result.status === "ready" || result.status === "partial") current.success = result;
    else if (current.success) return { ...current.success, stale: true, message: result.message ?? "刷新失败，显示上次成功数据", status: result.status };
    return result;
  }).finally(() => { current.pending = undefined; });
  return current.pending;
}

async function loadUsage(provider: UsageProvider): Promise<UpstreamUsage> {
  const ttl = ttlSeconds();
  const empty = (status: UpstreamUsage["status"], message: string): UpstreamUsage => ({ status, source: provider.adapter_kind,
    metrics: [], queriedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), message });
  if (provider.status === "deleted") return empty("unsupported", "Provider 已删除");
  if (provider.adapter_kind === "xai") return empty("unsupported", "该服务商暂不支持上游用量查询");
  try {
    if (provider.adapter_kind !== "generic") {
      if (!provider.managed_credential_id || !provider.account_auth_epoch) return empty("forbidden", "请先连接上游账号");
      const access = await resolveManagedProviderUsageAccess({ providerId: provider.id, adapterKind: provider.adapter_kind,
        authEpoch: provider.auth_epoch, managedAccountId: provider.managed_credential_id,
        managedAccountAuthEpoch: provider.account_auth_epoch, credentialRevision: provider.credential_revision ?? undefined });
      if (!access) return empty("unsupported", "该服务商暂不支持上游用量查询");
      return queryUpstreamUsage({ ...access, timeoutMs: provider.timeout_ms, ttlSeconds: ttl });
    }
    const source = provider.config?.usageSource;
    if (source !== "openrouter" && source !== "deepseek") return empty("unsupported", "该 Provider 未配置用量查询来源");
    if (!provider.api_key_ciphertext || !provider.api_key_iv || !provider.api_key_tag) return empty("forbidden", "请先配置上游查询凭据");
    const url = new URL(resolveProviderBaseUrl({ protocol: provider.protocol, baseUrl: provider.base_url ?? "" }));
    url.pathname = source === "openrouter" ? "/api/v1/key" : "/user/balance";
    url.search = "";
    const secret = decryptCredential({ ciphertext: provider.api_key_ciphertext, iv: provider.api_key_iv, tag: provider.api_key_tag });
    const headers = new Headers({ accept: "application/json", authorization: `Bearer ${secret}` });
    return queryUpstreamUsage({ source, url: url.toString(), headers, timeoutMs: provider.timeout_ms, ttlSeconds: ttl });
  } catch (error) {
    if (error instanceof ProviderProtocolError && error.category === "configuration"
      || error instanceof GatewayError && error.code.startsWith("PROVIDER_ENDPOINT")) {
      return empty("failed", "用量查询接口配置不可用，请检查查询来源");
    }
    return empty("forbidden", "查询凭据或账号状态不可用，请检查配置或重新授权");
  }
}

export async function handleProviderUsage(request: Request, providerId: string) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "providers.read");
    assertAdminMutationOrigin(request);
    const body = request.headers.get("content-length") === "0" ? {} : await request.json().catch(() => null);
    if (!z.object({}).strict().safeParse(body).success) throw new AdminError("PROVIDER_USAGE_INPUT_INVALID", "查询不接受额外参数", 400);
    const provider = await withPlatformClient(async (client) => (await client.query<UsageProvider>(
      `SELECT p.*, c.revision AS credential_revision, c.auth_epoch AS account_auth_epoch
       FROM ai_providers p LEFT JOIN ai_provider_managed_credentials c
         ON c.id = p.managed_credential_id AND c.provider_id = p.id AND c.adapter_kind = p.adapter_kind
       WHERE p.id = $1 AND p.status <> 'deleted'`, [providerId],
    )).rows[0]);
    if (!provider) throw new AdminError("PROVIDER_NOT_FOUND", "Provider 不存在", 404);
    const key = createHash("sha256").update(JSON.stringify([provider.status, provider.auth_revision, provider.auth_epoch,
      provider.managed_credential_id, provider.credential_revision, provider.account_auth_epoch, provider.config, provider.base_url, ttlSeconds()])).digest("hex");
    const data = await coalescedProviderUsage(provider.id, key, () => loadUsage(provider));
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) { return adminErrorResponse(error, requestId); }
}
