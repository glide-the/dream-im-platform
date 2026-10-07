// [Input] Named upstream usage source, server-only request credentials and bounded JSON responses.
// [Output] Semantic metrics that preserve missing values, currency, windows and reset timestamps.
// [Pos] Pure usage adapters; no database, scripts, inferred balances or platform billing aggregation.
import { readJsonRecord } from "./http";
export type UsageSource = "openrouter" | "deepseek" | "codex" | "github_copilot";
export type UpstreamMetric = { label: string; value: number; unit: "USD" | "CNY" | "percent" | "requests"; resetAt?: string; windowSeconds?: number };
export type UpstreamUsage = { status: "ready" | "partial" | "missing" | "unsupported" | "forbidden" | "failed";
  source: string; metrics: UpstreamMetric[]; notes?: string[]; queriedAt: string; expiresAt: string; stale?: boolean; message?: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown) => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
function money(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : undefined;
}
function date(value: unknown) {
  const parsed = typeof value === "number" ? new Date(value * 1_000) : typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}
export function parseUpstreamUsage(source: UsageSource, body: unknown) {
  const value = object(body);
  const metrics: UpstreamMetric[] = [];
  const notes: string[] = [];
  let missing = false;
  function add(label: string, raw: unknown, unit: UpstreamMetric["unit"], extra: Partial<UpstreamMetric> = {}) {
    const parsed = unit === "USD" || unit === "CNY" ? money(raw) : number(raw);
    if (parsed === undefined || unit === "percent" && parsed > 100
      || unit === "requests" && !Number.isSafeInteger(parsed)) { missing = true; return; }
    metrics.push({ label, value: parsed, unit, ...extra });
  }
  if (source === "openrouter") {
    const data = object(value.data);
    for (const [key, label] of [["usage", "Key 累计支出"], ["usage_daily", "Key 当日支出"], ["usage_weekly", "Key 当周支出"], ["usage_monthly", "Key 当月支出"], ["limit", "Key 消费额度"], ["limit_remaining", "Key 剩余额度"]]) add(label, data[key], "USD");
  } else if (source === "deepseek") {
    if (!Array.isArray(value.balance_infos)) missing = true;
    for (const balance of Array.isArray(value.balance_infos) ? value.balance_infos : []) {
      const info = object(balance);
      const currency = info.currency;
      if (currency !== "USD" && currency !== "CNY") { missing = true; continue; }
      for (const [key, label] of [["total_balance", "账户余额"], ["granted_balance", "赠送余额"], ["topped_up_balance", "充值余额"]]) add(label, info[key], currency);
    }
  } else if (source === "codex") {
    const limits = object(value.rate_limit);
    for (const [key, label] of [["primary_window", "主要窗口已用"], ["secondary_window", "次要窗口已用"]]) {
      const window = object(limits[key]);
      add(label, window.used_percent, "percent", { resetAt: date(window.reset_at), windowSeconds: number(window.limit_window_seconds) });
    }
  } else {
    const quotas = object(value.quota_snapshots);
    for (const [key, label] of [["premium_interactions", "Premium 请求"], ["chat", "Chat 请求"], ["completions", "补全请求"]]) {
      const quota = object(quotas[key]);
      if (quota.unlimited === true) { notes.push(`${label}不限量`); continue; }
      const extra = { resetAt: date(value.quota_reset_date) };
      add(`${label}总额度`, quota.entitlement, "requests", extra);
      add(`${label}剩余`, quota.remaining, "requests", extra);
    }
  }
  return { status: metrics.length || notes.length ? missing ? "partial" as const : "ready" as const : "missing" as const, metrics, ...(notes.length ? { notes } : {}) };
}

export async function queryUpstreamUsage(input: { source: UsageSource; url: string; headers: Headers; timeoutMs: number; ttlSeconds: number },
  dependencies: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<UpstreamUsage> {
  const now = dependencies.now ?? Date.now;
  const stamp = () => ({ queriedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + input.ttlSeconds * 1_000).toISOString() });
  try {
    const response = await (dependencies.fetcher ?? fetch)(input.url, { headers: input.headers, method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(input.timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status === 401 || response.status === 403 ? "forbidden" : "failed", source: input.source, metrics: [], ...stamp(),
        message: response.status === 401 || response.status === 403 ? "查询凭据或上游权限不足" : "上游用量查询失败" };
    }
    return { ...parseUpstreamUsage(input.source, await readJsonRecord(response)), source: input.source, ...stamp() };
  } catch {
    return { status: "failed", source: input.source, metrics: [], ...stamp(), message: "用量查询未完成，请稍后重试" };
  }
}
