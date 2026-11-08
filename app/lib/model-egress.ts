// [Input] Revisioned PostgreSQL policy, server-owned loopback proxy endpoint and original fetch requests.
// [Output] Per-request Docker NAT dispatch without global network mutation or silent proxy fallback.
// [Pos] Shared outbound boundary for model Providers, managed authentication and price discovery.
import type { PoolClient } from "pg";
import { ProxyAgent } from "undici";
import { withPlatformClient } from "./platform-db";
import { GatewayError } from "./gateway/errors";
import { modelEgressSetting, modelEgressStoredSchema, type ModelEgressPolicy } from "./model-egress-policy";

export class ModelEgressError extends GatewayError {
  constructor(code: string, message: string) { super(code, message, 503, "configuration_error"); this.name = "ModelEgressError"; }
}

export function modelEgressProxyUrl(environment: { MODEL_EGRESS_PROXY_URL?: string } = { MODEL_EGRESS_PROXY_URL: process.env.MODEL_EGRESS_PROXY_URL }) {
  const raw = environment.MODEL_EGRESS_PROXY_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.href;
  } catch {
    throw new ModelEgressError("MODEL_EGRESS_PROXY_INVALID", "本机 Docker NAT 代理配置无效，请联系运维检查");
  }
}

export async function readModelEgressPolicy(client: PoolClient): Promise<ModelEgressPolicy> {
  const { rows } = await client.query<{ value: unknown; status: string; is_secret: boolean }>(
    "SELECT value, status, is_secret FROM system_settings WHERE category = $1 AND key = $2",
    [modelEgressSetting.category, modelEgressSetting.key],
  );
  const row = rows[0];
  const stored = row ? modelEgressStoredSchema.safeParse(row.value) : null;
  if (row && (!stored?.success || row.status !== "active" || row.is_secret)) {
    throw new ModelEgressError("MODEL_EGRESS_POLICY_INVALID", "模型网络配置不可用，请联系管理员检查");
  }
  let configured = false;
  try { configured = modelEgressProxyUrl() !== null; } catch { /* Expose only unavailable capability. */ }
  const desiredEnabled = stored?.success ? stored.data.enabled : false;
  return {
    defaultEnabled: false, desiredEnabled, effectiveEnabled: desiredEnabled && configured, configured,
    revision: stored?.success ? stored.data.revision : null,
    status: desiredEnabled ? configured ? "enabled" : "unavailable" : "disabled",
  };
}

let proxy: { url: string; agent: ProxyAgent } | undefined;
// Resolve policy before Gateway marks a Provider dispatch as attempted.
export async function resolveModelEgressFetch(signal?: AbortSignal | null): Promise<typeof fetch> {
  signal?.throwIfAborted();
  const loading = withPlatformClient(readModelEgressPolicy).catch((error: unknown) => {
    if (error instanceof ModelEgressError) throw error;
    throw new ModelEgressError("MODEL_EGRESS_POLICY_UNAVAILABLE", "暂时无法读取模型网络配置");
  });
  let onAbort: (() => void) | undefined;
  const aborted = signal ? new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  }) : undefined;
  let policy: ModelEgressPolicy;
  try { policy = await (aborted ? Promise.race([loading, aborted]) : loading); }
  finally { if (onAbort) signal?.removeEventListener("abort", onAbort); }
  signal?.throwIfAborted();
  if (!policy.desiredEnabled) return globalThis.fetch;
  const url = modelEgressProxyUrl();
  if (!url) throw new ModelEgressError("MODEL_EGRESS_PROXY_UNAVAILABLE", "尚未配置本机 Docker NAT 代理，请联系运维配置");
  if (proxy?.url !== url) {
    const previous = proxy;
    proxy = { url, agent: new ProxyAgent(url) };
    // Closing drains dispatched requests without interrupting their response streams.
    void previous?.agent.close().catch(() => undefined);
  }
  const agent = proxy.agent;
  return (input, init) => {
    const options: RequestInit & { dispatcher: ProxyAgent } = { ...init, dispatcher: agent };
    return globalThis.fetch(input, options);
  };
}
export const modelEgressFetch: typeof fetch = async (input, init) => {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return (await resolveModelEgressFetch(signal))(input, init);
};
