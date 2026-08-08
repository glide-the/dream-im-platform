"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PayloadDetail = {
  summary: Record<string, unknown>;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  rawSse: string;
};

function render(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function Summary({ title, record, keys }: { title: string; record: Record<string, unknown>; keys: string[] }) {
  return <section className="border-t border-border pt-5"><h3 className="font-display text-lg font-semibold">{title}</h3><dl className="mt-3 grid gap-x-5 sm:grid-cols-2">{keys.map((key) => <div key={key} className="min-w-0 border-b border-border py-3"><dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{key}</dt><dd className="mt-1 break-words font-mono text-xs leading-6 text-text-secondary tabular-nums">{render(record[key])}</dd></div>)}</dl></section>;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function RateLimitReason({ record }: { record: Record<string, unknown> }) {
  if (Number(record.http_status) !== 429) return null;
  const summary = asRecord(record.response_summary);
  if (!summary || summary.rejection_stage !== "preauthorization") return null;
  const current = finiteNumber(summary.current);
  const requested = finiteNumber(summary.requested);
  const limit = finiteNumber(summary.limit);
  const remaining = finiteNumber(summary.remaining);
  const exceededBy = finiteNumber(summary.exceeded_by);
  if ([current, requested, limit, remaining, exceededBy].some((value) => value === undefined)) return null;
  const windowLabel = summary.limit_window === "minute"
    ? "每分钟请求数"
    : summary.limit_window === "month"
      ? "每月 Token"
      : "每日 Token";
  const unit = summary.limit_metric === "requests" ? "次" : "tokens";
  const format = (value: number | undefined) => `${new Intl.NumberFormat("zh-CN").format(value ?? 0)} ${unit}`;
  const policySearch = new URLSearchParams();
  if (record.email) policySearch.set("email", String(record.email));
  if (record.model_code) policySearch.set("model_code", String(record.model_code));
  const policyBase = `/admin/gateway/rate-limits${policySearch.size ? `?${policySearch.toString()}` : ""}`;
  const isRequestLimit = summary.limit_metric === "requests";
  const primaryPolicyHref = `${policyBase}#platform-users-manager`;
  return <section className="border border-danger/35 bg-danger-light p-4" data-testid="gateway-rate-limit-reason" role="alert">
    <p className="font-display text-lg font-semibold text-danger">{windowLabel} 上限已超出</p>
    <p className="mt-2 text-sm leading-6 text-text-secondary">当前已计数 <strong>{format(current)}</strong>，本次请求需预留 <strong>{format(requested)}</strong>，超过上限 <strong>{format(limit)}</strong>。</p>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[{ label: "当前", value: current }, { label: "本次预留", value: requested }, { label: "请求前剩余", value: remaining }, { label: "超出", value: exceededBy }].map((item) => <div key={item.label} className="border border-danger/20 bg-bg-surface/65 p-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{item.label}</dt><dd className="mt-1 font-mono text-xs tabular-nums text-text-primary">{format(item.value)}</dd></div>)}
    </dl>
    <p className="mt-3 text-xs leading-5 text-text-tertiary">该请求在 Provider 调用前被预授权策略拒绝；本次预留包含输入估算与最大输出预算。</p>
    <div className="mt-4 border-t border-danger/20 pt-4">
      {isRequestLimit ? <p className="text-xs leading-5 text-text-secondary">请求频率策略暂未在 Admin 开放配置；实时窗口只展示已经发生的请求计数。</p> : <><p className="text-xs leading-5 text-text-secondary">实际生效上限取用户默认、模型覆盖与套餐权益中的最小值。实时用量窗口是只读计数，不应通过修改计数解除 429。</p><div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap"><Link href={primaryPolicyHref} className="inline-flex min-h-11 shrink-0 items-center justify-center bg-danger px-4 text-sm font-semibold text-white" data-testid="gateway-rate-limit-config-link">配置此用户的默认 Token 上限</Link><Link href={`${policyBase}#user-model-permissions-manager`} className="inline-flex min-h-11 items-center justify-center border border-danger/35 bg-bg-surface px-4 text-sm font-semibold text-danger">检查模型覆盖策略</Link><Link href={`/admin/subscriptions/entitlements${record.model_code ? `?model_code=${encodeURIComponent(String(record.model_code))}` : ""}#subscription-entitlements-manager`} className="inline-flex min-h-11 items-center justify-center px-2 text-sm font-semibold text-text-secondary underline decoration-border">检查套餐权益</Link></div></>}
    </div>
  </section>;
}

function Viewer({ label, content, json }: { label: string; content: unknown; json?: boolean }) {
  const text = json ? JSON.stringify(content ?? null, null, 2) : String(content ?? "");
  return <section className="min-w-0 border border-border"><header className="flex items-center justify-between gap-3 border-b border-border bg-bg-secondary/45 px-4 py-3"><h4 className="text-sm font-semibold">{label}</h4><button type="button" className="min-h-9 border border-border bg-bg-surface px-3 text-xs font-semibold" onClick={() => navigator.clipboard.writeText(text)} data-no-analytics="true">复制</button></header><pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5 text-text-secondary">{text || "—"}</pre></section>;
}

export default function GatewayRequestDetail({ record, onClose }: { record: Record<string, unknown>; onClose: () => void }) {
  const [payload, setPayload] = useState<PayloadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function reveal() {
    if (!window.confirm("完整报文可能包含个人内容和 Prompt。确认本次查看将写入不可变审计日志。")) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/gateway-requests/${encodeURIComponent(String(record.id))}/payload`, { headers: { accept: "application/json", "x-gateway-payload-confirmation": "reveal" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      setPayload(body.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "完整报文加载失败");
    } finally {
      setLoading(false);
    }
  }

  const capture = payload ? {
    request_completion: payload.request?.completion_status,
    request_bytes: payload.request?.byte_length,
    request_sha256: payload.request?.sha256,
    response_completion: payload.response?.completion_status,
    response_bytes: payload.response?.byte_length,
    response_sha256: payload.response?.sha256,
    provider_request_id: payload.response?.provider_request_id,
  } : {};

  return <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="gateway-request-detail-title"><button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="关闭请求详情" /><aside className="absolute inset-y-0 right-0 w-full max-w-full overflow-y-auto border-l border-border bg-bg-surface shadow-medium sm:w-[min(92vw,860px)]"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-bg-surface px-5 py-5 sm:px-7"><div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Gateway request trace</p><h2 id="gateway-request-detail-title" className="mt-2 font-display text-2xl font-semibold">请求详情</h2><p className="mt-2 break-all font-mono text-[11px] text-text-tertiary">{String(record.id)}</p></div><button type="button" onClick={onClose} className="min-h-11 shrink-0 border border-border px-4 text-sm">关闭</button></header><div className="space-y-7 p-5 sm:p-7">
    <Summary title="Request Summary" record={record} keys={["protocol", "status", "outcome", "http_status", "is_streaming", "requested_model", "resolved_model", "provider_code", "model_code"]} />
    <Summary title="User、Gateway Key 与路由" record={record} keys={["platform_user_id", "email", "gateway_api_key_id", "gateway_key_name", "key_prefix", "provider_id", "model_id", "upstream_request_id"]} />
    <Summary title="Token、价格快照与延迟" record={record} keys={["estimated_tokens", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "input_price_snapshot", "output_price_snapshot", "cache_read_price_snapshot", "cache_write_price_snapshot", "first_token_ms", "latency_ms", "created_at", "completed_at"]} />
    <RateLimitReason record={record} />
    <Summary title="错误与中断" record={record} keys={["error_code", "error_message", "response_summary", "status", "outcome"]} />
    <div className="flex flex-wrap gap-3"><Link href={`/admin/billing/ledger?gateway_request_id=${encodeURIComponent(String(record.id))}`} className="inline-flex min-h-11 items-center border border-border px-4 text-sm font-semibold">查看 Ledger</Link><Link href={`/admin/system/audit?resource_id=${encodeURIComponent(String(record.id))}`} className="inline-flex min-h-11 items-center border border-border px-4 text-sm font-semibold">查看 Audit</Link></div>
    <section className="border border-warning/45 bg-accent-orange-light p-4"><h3 className="font-display text-lg font-semibold">完整应用层报文</h3><p className="mt-2 text-sm leading-6 text-text-secondary">需要 <code className="font-mono text-xs">gateway.payloads.read</code>。默认不加载；每次查看都会留下只含访问元数据的不可变审计，内容不会发送到 analytics。</p>{!payload ? <button type="button" disabled={loading} onClick={reveal} className="mt-4 min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{loading ? "正在读取…" : "二次确认并查看完整报文"}</button> : null}{error ? <p className="mt-3 border border-danger/35 bg-danger-light p-3 text-sm text-danger" role="alert">{error}</p> : null}</section>
    {payload ? <div className="min-w-0 space-y-6" data-testid="gateway-full-payload"><Summary title="报文捕获状态" record={capture} keys={Object.keys(capture)} /><Viewer label="请求 Headers（持久化前已脱敏）" content={payload.request?.headers} json /><Viewer label="完整请求 JSON" content={payload.request?.body_json} json /><Viewer label="请求 Raw Body" content={payload.request?.body_text} />{payload.response?.body_json ? <Viewer label="非流式完整响应 JSON" content={payload.response.body_json} json /> : null}{payload.response?.body_text ? <Viewer label="响应 Raw Body" content={payload.response.body_text} /> : null}{payload.events.length ? <section className="min-w-0"><h3 className="font-display text-lg font-semibold">SSE Event 时间线</h3><div className="mt-3 max-w-full overflow-x-auto border border-border"><table className="min-w-full text-left text-xs"><thead><tr className="border-b border-border bg-bg-secondary/45">{["Sequence", "Event Type", "Elapsed", "Bytes", "Time", "Raw Data"].map((item) => <th key={item} className="whitespace-nowrap px-3 py-3 font-mono text-[10px] uppercase text-text-tertiary">{item}</th>)}</tr></thead><tbody>{payload.events.map((event) => <tr key={String(event.sequence)} className="border-b border-border align-top"><td className="px-3 py-3 font-mono tabular-nums">{String(event.sequence)}</td><td className="px-3 py-3"><span className="inline-flex whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-semibold">{String(event.event_type)}</span></td><td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">{String(event.elapsed_ms)} ms</td><td className="px-3 py-3 font-mono tabular-nums">{String(event.byte_length)}</td><td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">{new Date(String(event.emitted_at)).toLocaleString("zh-CN")}</td><td className="max-w-[420px] px-3 py-3"><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4">{String(event.raw_data)}</pre></td></tr>)}</tbody></table></div></section> : null}{payload.rawSse ? <Viewer label="Raw SSE Viewer" content={payload.rawSse} /> : null}</div> : null}
  </div></aside></div>;
}
