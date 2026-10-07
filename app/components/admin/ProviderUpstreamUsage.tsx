"use client";
// [Input] Provider ID and safe upstream metrics from the protected server endpoint.
// [Output] Manual loading/partial/missing/unsupported/forbidden/error/stale usage display.
// [Pos] Provider card account metrics, distinct from local Gateway traffic and user billing.
import { useEffect, useRef, useState } from "react";
import type { UpstreamUsage } from "@/lib/providers/upstream-usage";
const labels = { ready: "", partial: "部分指标可用", missing: "上游未返回可用指标", unsupported: "不支持查询", forbidden: "凭据或权限不足", failed: "查询失败" };
export default function ProviderUpstreamUsage({ providerId }: { providerId: string }) {
  const [data, setData] = useState<UpstreamUsage>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!data) return;
    const remaining = Date.parse(data.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [data]);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/usage`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "用量查询未完成");
      setData(body.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "查询失败"); setData((current) => current ? { ...current, stale: true } : current); }
    finally { setPending(false); inFlight.current = false; }
  }
  return <section className="mt-4 border-t border-border pt-4" aria-label="上游用量">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold">上游用量</h4>
      <button type="button" onClick={refresh} disabled={pending} className="min-h-10 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-50">{pending ? "查询中…" : data ? "刷新上游用量" : "查询上游用量"}</button></div>
    <div aria-live="polite" className="mt-2 text-xs text-text-secondary">
      {pending ? <p role="status">正在查询上游账户…</p> : null}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      {data ? <>
        {(data.stale || (expired && (data.metrics.length > 0 || Boolean(data.notes?.length)))) ? <p className="text-accent-orange">数据已过期，显示上次成功查询</p> : null}
        {data.status !== "ready" ? <p>{data.message ?? labels[data.status]}</p> : null}
        {data.notes?.map((note) => <p key={note}>{note}</p>)}
        <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.metrics.map((metric, index) => <div key={`${metric.label}-${metric.unit}-${index}`}>
          <dt className="text-text-tertiary">{metric.label}</dt><dd className="mt-1 font-mono font-semibold text-text-primary">{metric.unit === "USD" || metric.unit === "CNY" ? `${(metric.value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} ${metric.unit}` : `${metric.value.toLocaleString("zh-CN")} ${metric.unit === "percent" ? "%" : "次"}`}</dd>
          {metric.windowSeconds ? <p className="mt-1 text-text-tertiary">窗口 {metric.windowSeconds / 3600} 小时</p> : null}
          {metric.resetAt ? <p className="mt-1 text-text-tertiary">重置 {new Date(metric.resetAt).toLocaleString("zh-CN")}</p> : null}
        </div>)}</dl>
        <p className="mt-3 text-[10px] text-text-tertiary">来源 {data.source} · 查询于 {new Date(data.queriedAt).toLocaleString("zh-CN")}</p>
      </> : !pending ? <p>查询上游账户余额或配额</p> : null}
    </div>
  </section>;
}
