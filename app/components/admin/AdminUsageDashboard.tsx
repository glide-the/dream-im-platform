"use client";
// [Sync] 2026-10-11: preserve official Responses reported-Token scope and inclusive cache accounting.

// [Sync] 2026-10-10: label known Token subtotals and omit wholly unknown trend buckets from the line.
// [Input] Admin usage aggregates and request rows with nullable Image usage/cost facts.
// [Output] Filterable usage dashboard that never renders unknown cost or Token detail as zero.
// [Pos] Shared Admin billing/request presentation; server queries own aggregation and authorization.
// [Sync] 2026-10-09: label unknown Image usage/cost and show known subtotals separately.
// [Sync] 2026-10-10: identify versioned platform base amounts in usage aggregates and details.
// [Sync] 2026-10-10: keep Image request type, usage and price snapshots in the shared billing module.
// [Sync] 2026-10-10: restore only supported automatic-refresh choices from the existing URL state.

import { type CrudFilter, useList } from "@refinedev/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminCollapsibleFilters, AdminListHeader, countActiveFilterValues, haveFilterValuesChanged } from "./AdminListChrome";

type DashboardData = {
  summary: Record<string, unknown>;
  trend: Array<Record<string, unknown>>;
  providerStats: Array<Record<string, unknown>>;
  modelStats: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
};

type DashboardFilters = {
  from: string;
  to: string;
  protocol: string;
  operation: string;
  providerId: string;
  modelId: string;
  platformUserId: string;
  outcome: string;
  refreshSeconds: string;
};

function initialFilters(params?: { get(name: string): string | null }): DashboardFilters {
  const today = new Date();
  const refreshSeconds = params?.get("refreshSeconds") ?? "0";
  return {
    from: params?.get("from") ?? new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10),
    to: params?.get("to") ?? today.toISOString().slice(0, 10),
    protocol: params?.get("protocol") ?? "",
    operation: params?.get("operation") ?? "",
    providerId: params?.get("providerId") ?? "",
    modelId: params?.get("modelId") ?? "",
    platformUserId: params?.get("platformUserId") ?? "",
    outcome: params?.get("outcome") ?? "",
    refreshSeconds: ["0", "15", "30", "60"].includes(refreshSeconds) ? refreshSeconds : "0",
  };
}

function int(value: unknown) {
  try {
    return BigInt(String(value ?? 0)).toLocaleString("zh-CN");
  } catch {
    return "—";
  }
}

function usd(value: unknown) {
  try {
    const micros = BigInt(String(value ?? 0));
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
    return `$${whole}.${fraction}`;
  } catch {
    return "—";
  }
}

function usdWithUnknown(value: unknown, unknownCount: unknown) {
  const count = Number(unknownCount ?? 0);
  return count > 0 ? `${usd(value)}（另 ${count} 项未知）` : usd(value);
}

function successRate(row: Record<string, unknown>) {
  const requests = Number(row.requests ?? 0);
  const successful = Number(row.successful_requests ?? 0);
  return requests ? `${((successful / requests) * 100).toFixed(1)}%` : "—";
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dialogRef.current?.showModal();
    let cancelled = false;
    fetch(`/api/admin/usage/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
        if (!cancelled) setRecord(body.data);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "请求详情加载失败"); });
    return () => { cancelled = true; };
  }, [id]);
  const summary = record?.response_summary && typeof record.response_summary === "object" ? record.response_summary as Record<string, unknown> : undefined;
  const nativeRequest = summary?.billingScope === "responses_reported_tokens" || (Array.isArray(summary?.imageCalls) && summary.imageCalls.length > 0);
  const displayRecord = record?.usage_known === false
    ? { ...record, input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, input_text_tokens: null, input_image_tokens: null, output_text_tokens: null, output_image_tokens: null, provider_cost_microusd: null, charged_microusd: null }
    : record;
  const section = (title: string, keys: string[]) => <section className="border-t border-border pt-5"><h3 className="font-display text-lg font-semibold">{title}</h3><dl className="mt-3 grid gap-x-5 sm:grid-cols-2">{keys.map((key) => <div key={key} className="border-b border-border py-3"><dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{key === "provider_cost_microusd" ? "平台基础金额（micro-USD）" : key === "charged_microusd" ? "调用方收费（micro-USD）" : key}</dt><dd className={`mt-1 break-words text-sm leading-6 text-text-secondary ${/(id|model|price|token|microusd|status|code)/.test(key) ? "font-mono text-xs" : ""}`}>{displayRecord ? (typeof displayRecord[key] === "object" ? JSON.stringify(displayRecord[key], null, 2) : String(displayRecord[key] ?? "—")) : "—"}</dd></div>)}</dl></section>;
  return <dialog ref={dialogRef} className="admin-dialog admin-dialog--drawer" onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="admin-dialog-frame"><header className="admin-dialog-header"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Gateway request trace</p><h2 className="mt-2 font-display text-2xl font-semibold">请求详情</h2><p className="mt-2 break-all font-mono text-[11px] text-text-tertiary">{id}</p></div><button type="button" className="min-h-11 border border-border px-4 text-sm" onClick={onClose}>关闭</button></header><div className="admin-dialog-body">{error ? <div className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</div> : !record ? <div className="space-y-3" aria-label="正在加载请求详情"><span className="block h-5 w-2/3 animate-pulse bg-bg-secondary" /><span className="block h-40 animate-pulse bg-bg-secondary" /></div> : <div className="space-y-7">{record.status === "settlement_failed" ? <p className="border border-danger/35 bg-danger-light p-4 text-sm leading-6 text-danger">自动结算失败已记录。该记录仅供查询与审计，不提供人工修改 Token、余额或账本的操作。</p> : null}{record.usage_known === false ? <p className="border border-warning/35 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary">Provider 未返回可核验的完整 Token 明细；平台基础金额与收费未知，不显示为 0。</p> : null}{nativeRequest ? <p className="border border-border p-4 text-sm leading-6 text-text-secondary">有效的 Responses 请求报告 Token 按平台模型价格快照结算；缓存包含在输入、推理包含在输出。完整上游图片费用未单独报告，不能由平台金额推算。缺失或非法用量保持未知。</p> : null}{section("用户与 Gateway Key", ["platform_user_id", "email", "gateway_api_key_id", "gateway_key_name", "key_prefix"])}{section("路由与模型解析", ["operation", "protocol", "provider_code", "model_code", "requested_model", "resolved_model", "pricing_rule_id", "status", "outcome", "http_status"])}{section("Token 用量", ["input_token_semantics", "estimated_tokens", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", ...(String(record.operation).startsWith("images.") ? ["input_text_tokens", "input_image_tokens", "output_image_tokens"] : [])])}{section("价格快照与平台金额", ["input_price_snapshot", "output_price_snapshot", "cache_read_price_snapshot", "cache_write_price_snapshot", ...(String(record.operation).startsWith("images.") ? ["image_input_price_snapshot", "image_output_price_snapshot"] : []), "markup_bps_snapshot", "discount_bps_snapshot", "reserved_microusd", "provider_cost_microusd", "charged_microusd"])}{section("性能与时间", ["first_token_ms", "latency_ms", "created_at", "started_at", "completed_at", "settled_at"])}{section("错误与安全摘要", ["error_code", "error_message", "response_summary"])}</div>}</div></div></dialog>;
}

function tokensWithUnknown(value: unknown, unknownCount: unknown) {
  const count = Number(unknownCount ?? 0);
  return count > 0 ? `${int(value)} 已知小计，另 ${int(unknownCount)} 项未知` : int(value);
}

function TrendChart({ rows }: { rows: Array<Record<string, unknown>> }) {
  const segments = useMemo(() => {
    const values = rows.map((row) => Number(row.tokens ?? (Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0) + Number(row.cache_read_tokens ?? 0) + Number(row.cache_write_tokens ?? 0))));
    const max = Math.max(1, ...values);
    const result: string[] = [];
    let segment: string[] = [];
    rows.forEach((row, index) => {
      const entirelyUnknown = Number(row.requests ?? 0) > 0 && Number(row.unknown_cost_requests ?? 0) >= Number(row.requests);
      if (entirelyUnknown) {
        if (segment.length) result.push(segment.join(" "));
        segment = [];
      } else segment.push(`${rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 100},${40 - (values[index]! / max) * 36}`);
    });
    if (segment.length) result.push(segment.join(" "));
    return result;
  }, [rows]);
  const unknown = rows.reduce((sum, row) => sum + Number(row.unknown_cost_requests ?? 0), 0);
  return <section className="border-y border-border py-5"><div className="flex items-end justify-between gap-4"><div><h3 className="font-display text-lg font-semibold">使用趋势</h3><p className="mt-1 text-xs text-text-tertiary">已知处理 Token 小计；{unknown > 0 ? `另 ${int(unknown)} 项用量未知，全部未知的时间桶留空。` : "当前范围没有未知用量。"}</p></div><span className="font-mono text-[10px] text-text-tertiary">{rows.length} 个时间桶</span></div>{rows.length ? <div className="mt-4 overflow-hidden"><svg viewBox="0 0 100 42" role="img" aria-label="已知 Token 使用趋势" className="h-44 w-full" preserveAspectRatio="none"><line x1="0" y1="40" x2="100" y2="40" stroke="currentColor" className="text-border" strokeWidth="0.35" />{segments.map((points, index) => <polyline key={index} points={points} fill="none" stroke="currentColor" className="text-accent" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}</svg><div className="flex justify-between font-mono text-[9px] text-text-tertiary"><span>{new Date(String(rows[0]?.bucket)).toLocaleString("zh-CN")}</span><span>{new Date(String(rows.at(-1)?.bucket)).toLocaleString("zh-CN")}</span></div></div> : <p className="mt-6 py-12 text-center text-sm text-text-tertiary">当前范围没有可绘制的真实请求。</p>}</section>;
}

export default function AdminUsageDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<DashboardFilters>(() => initialFilters(searchParams));
  const [filters, setFilters] = useState<DashboardFilters>(() => initialFilters(searchParams));
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"requests" | "providers" | "models">("requests");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [selectedUserLabel, setSelectedUserLabel] = useState("");
  function syncUrl(next: DashboardFilters) {
    const params = new URLSearchParams(
      Object.entries(next).filter(([, value]) => value && value !== "0"),
    );
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }
  const providers = useList<Record<string, unknown>>({ resource: "providers", pagination: { currentPage: 1, pageSize: 100 }, sorters: [{ field: "name", order: "asc" }] });
  const models = useList<Record<string, unknown>>({ resource: "models", pagination: { currentPage: 1, pageSize: 100 }, sorters: [{ field: "display_name", order: "asc" }], filters: filters.providerId ? [{ field: "provider_id", operator: "eq", value: filters.providerId }] : [] });
  const users = useList<Record<string, unknown>>({ resource: "platform-users", pagination: { currentPage: userPage, pageSize: 50 }, sorters: [{ field: "email", order: "asc" }], filters: userSearch.trim() ? [{ field: "email", operator: "contains", value: userSearch.trim() }] : [] });
  const userTotal = users.result.total ?? 0;
  const userPages = Math.max(1, Math.ceil(userTotal / 50));
  const listFilters = useMemo<CrudFilter[]>(() => [
    filters.from && { field: "created_at", operator: "gte", value: `${filters.from}T00:00:00.000Z` },
    filters.to && { field: "created_at", operator: "lte", value: `${filters.to}T23:59:59.999999Z` },
    filters.protocol && { field: "protocol", operator: "eq", value: filters.protocol },
    filters.operation && { field: "operation", operator: "eq", value: filters.operation },
    filters.providerId && { field: "provider_id", operator: "eq", value: filters.providerId },
    filters.modelId && { field: "model_id", operator: "eq", value: filters.modelId },
    filters.platformUserId && { field: "platform_user_id", operator: "eq", value: filters.platformUserId },
    filters.outcome && { field: "outcome", operator: "eq", value: filters.outcome },
  ].filter(Boolean) as CrudFilter[], [filters]);
  const requests = useList<Record<string, unknown>>({ resource: "usage", pagination: { currentPage: page, pageSize: 20 }, sorters: [{ field: "created_at", order: "desc" }], filters: listFilters });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      const params = new URLSearchParams(Object.entries(filters).filter(([key, value]) => key !== "refreshSeconds" && value));
      fetch(`/api/admin/usage-dashboard?${params}`, { headers: { accept: "application/json" } })
        .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`); if (!cancelled) { setData(body.data); setError(""); } })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Usage 聚合暂时不可用"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const seconds = Number(filters.refreshSeconds);
    const timer = seconds > 0 ? window.setInterval(load, seconds * 1000) : undefined;
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, [filters]);
  const summary = data?.summary ?? {};
  const requestsTotal = Number(summary.requests ?? 0);
  const summaryItems = [
    ["请求数", int(summary.requests)],
    ["成功率", requestsTotal ? `${((Number(summary.successful_requests ?? 0) / requestsTotal) * 100).toFixed(1)}%` : "—"],
    ["Input", tokensWithUnknown(summary.input_tokens, summary.unknown_cost_requests)],
    ["Output", tokensWithUnknown(summary.output_tokens, summary.unknown_cost_requests)],
    ["Cache Read", tokensWithUnknown(summary.cache_read_tokens, summary.unknown_cost_requests)],
    ["Cache Write", tokensWithUnknown(summary.cache_write_tokens, summary.unknown_cost_requests)],
    ["平台基础金额", usdWithUnknown(summary.provider_cost_microusd, summary.unknown_cost_requests)],
    ["实际收费", usdWithUnknown(summary.charged_microusd, summary.unknown_cost_requests)],
  ];
  return <section className="admin-panel min-w-0 overflow-hidden"><AdminListHeader title="使用统计" description="直接采用 cc-switch 的全局筛选、趋势和三统计页签；所有值来自真实 Gateway 请求。" meta={<span className="font-mono text-[10px] text-text-tertiary">UTC · {data?.meta.generatedAt ? new Date(String(data.meta.generatedAt)).toLocaleString("zh-CN") : "尚未生成"}</span>} />
    <AdminCollapsibleFilters activeCount={countActiveFilterValues(filters)} dirty={haveFilterValuesChanged(draft, filters)}><form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setFilters(draft); setPage(1); syncUrl(draft); }}><label className="text-xs font-semibold text-text-secondary">开始日期<input type="date" className="admin-field mt-1 text-sm" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} required /></label><label className="text-xs font-semibold text-text-secondary">结束日期<input type="date" className="admin-field mt-1 text-sm" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} required /></label><label className="text-xs font-semibold text-text-secondary">协议<select className="admin-field mt-1 text-sm" value={draft.protocol} onChange={(event) => setDraft((current) => ({ ...current, protocol: event.target.value }))}><option value="">全部协议</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label><label className="text-xs font-semibold text-text-secondary">调用类型<select className="admin-field mt-1 text-sm" value={draft.operation} onChange={(event) => setDraft((current) => ({ ...current, operation: event.target.value }))}><option value="">全部类型</option><option value="text">文本</option><option value="images.generations">图像生成</option><option value="images.edits">图像编辑</option></select></label><label className="text-xs font-semibold text-text-secondary">Provider<select className="admin-field mt-1 text-sm" value={draft.providerId} onChange={(event) => setDraft((current) => ({ ...current, providerId: event.target.value, modelId: "" }))}><option value="">全部 Provider</option>{providers.result.data.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)} · {String(item.code)}</option>)}</select></label><label className="text-xs font-semibold text-text-secondary">模型<select className="admin-field mt-1 text-sm" value={draft.modelId} onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}><option value="">全部模型</option>{models.result.data.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.display_name)} · {String(item.code)}</option>)}</select></label><div className="space-y-2 text-xs font-semibold text-text-secondary"><label>搜索平台用户<input type="search" className="admin-field mt-1 text-sm" value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserPage(1); }} placeholder="输入完整或部分 Email" /></label><label className="block">平台用户<select className="admin-field mt-1 text-sm" value={draft.platformUserId} onChange={(event) => { const next = event.target.value; const selected = users.result.data.find((item) => String(item.id) === next); setSelectedUserLabel(selected ? String(selected.email ?? selected.display_name ?? selected.id) : ""); setDraft((current) => ({ ...current, platformUserId: next })); }}><option value="">全部用户</option>{draft.platformUserId && !users.result.data.some((item) => String(item.id) === draft.platformUserId) ? <option value={draft.platformUserId}>{selectedUserLabel || draft.platformUserId}</option> : null}{users.result.data.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.email ?? item.display_name ?? item.id)}</option>)}</select></label><span className="flex items-center justify-between gap-2 font-normal text-text-tertiary"><span>{users.query.error ? "加载失败" : `${userTotal} 位 · ${userPage}/${userPages}`}</span><span className="flex gap-1"><button type="button" className="min-h-10 border border-border px-2 disabled:opacity-40" disabled={userPage <= 1 || users.query.isFetching} onClick={() => setUserPage((current) => Math.max(1, current - 1))}>上一页</button><button type="button" className="min-h-10 border border-border px-2 disabled:opacity-40" disabled={userPage >= userPages || users.query.isFetching} onClick={() => setUserPage((current) => Math.min(userPages, current + 1))}>下一页</button></span></span></div><label className="text-xs font-semibold text-text-secondary">结果<select className="admin-field mt-1 text-sm" value={draft.outcome} onChange={(event) => setDraft((current) => ({ ...current, outcome: event.target.value }))}><option value="">全部结果</option><option value="success">成功</option><option value="failed">失败</option><option value="pending">待处理</option></select></label><label className="text-xs font-semibold text-text-secondary">自动刷新<select className="admin-field mt-1 text-sm" value={draft.refreshSeconds} onChange={(event) => setDraft((current) => ({ ...current, refreshSeconds: event.target.value }))}><option value="0">关闭</option><option value="15">15 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label><div className="flex items-end gap-2 sm:col-span-2 xl:col-span-4"><button className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface">查询</button><button type="button" className="min-h-11 border border-border px-4 text-sm" onClick={() => { const next = initialFilters(); setDraft(next); setFilters(next); setPage(1); setUserSearch(""); setUserPage(1); setSelectedUserLabel(""); router.replace(pathname, { scroll: false }); }}>重置</button></div></form></AdminCollapsibleFilters>
    {error ? <div className="m-5 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert"><p className="font-semibold">真实聚合暂不可用</p><p className="mt-1">{error}</p></div> : null}
    <div className="p-5">{loading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="正在加载使用统计">{Array.from({ length: 8 }).map((_, index) => <span key={index} className="h-20 animate-pulse border border-border bg-bg-secondary" />)}</div> : <dl className="grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">{summaryItems.map(([label, value]) => <div key={label} className="border-b border-r border-border p-4"><dt className="text-xs text-text-tertiary">{label}</dt><dd className="mt-2 font-mono text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>}<TrendChart rows={data?.trend ?? []} />
      <div className="mt-6 flex max-w-full gap-1 overflow-x-auto border-b border-border" role="tablist">{[["requests", "请求日志"], ["providers", "Provider 统计"], ["models", "模型统计"]].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value as typeof tab)} className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === value ? "border-text-primary text-text-primary" : "border-transparent text-text-tertiary"}`}>{label}</button>)}</div>
      {tab === "requests" ? <div className="mt-4 max-w-full overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-border bg-bg-secondary/45">{["时间", "用户", "调用类型", "Provider", "模型", "Input", "Output", "Cache R/W", "收费", "状态", "结果", "操作"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</th>)}</tr></thead><tbody>{requests.query.isLoading ? <tr><td colSpan={12} className="p-8 text-center">正在加载请求…</td></tr> : requests.result.data.map((row) => <tr key={String(row.id)} className="border-b border-border"><td className="whitespace-nowrap px-3 py-3 text-xs">{new Date(String(row.created_at)).toLocaleString("zh-CN")}</td><td className="px-3 py-3">{String(row.email ?? "—")}</td><td className="whitespace-nowrap px-3 py-3">{row.operation === "images.generations" ? "图像生成" : row.operation === "images.edits" ? "图像编辑" : "文本"}</td><td className="px-3 py-3">{String(row.provider_code ?? "—")}</td><td className="px-3 py-3 font-mono text-xs">{String(row.requested_model ?? "—")}</td><td className="px-3 py-3 text-right font-mono text-xs">{row.usage_known === false ? "未知" : int(row.input_tokens)}</td><td className="px-3 py-3 text-right font-mono text-xs">{row.usage_known === false ? "未知" : int(row.output_tokens)}</td><td className="px-3 py-3 text-right font-mono text-xs">{row.usage_known === false ? "未知" : `${int(row.cache_read_tokens)} / ${int(row.cache_write_tokens)}`}</td><td className="px-3 py-3 text-right font-mono text-xs">{row.usage_known === false ? "未知" : usd(row.display_charged_microusd)}</td><td className="px-3 py-3">{String(row.status ?? "—")}</td><td className="px-3 py-3">{String(row.outcome ?? row.status ?? "—")}</td><td className="px-3 py-3"><button type="button" className="min-h-10 text-xs font-semibold underline" onClick={() => setDetailId(String(row.id))}>查看</button></td></tr>)}{!requests.query.isLoading && !requests.result.data.length ? <tr><td colSpan={12} className="p-10 text-center text-sm text-text-tertiary">当前真实筛选范围没有请求。</td></tr> : null}</tbody></table><div className="flex justify-between border-t border-border py-4"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 border border-border px-4 text-xs disabled:opacity-40">上一页</button><span className="font-mono text-xs text-text-tertiary">第 {page} / {Math.max(1, Math.ceil(requests.result.total / 20))} 页 · 共 {requests.result.total} 项</span><button type="button" disabled={page * 20 >= requests.result.total} onClick={() => setPage((current) => current + 1)} className="min-h-10 border border-border px-4 text-xs disabled:opacity-40">下一页</button></div></div> : <div className="mt-4 max-w-full overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-border bg-bg-secondary/45">{(tab === "providers" ? ["Provider", "请求", "成功率", "Tokens", "平台基础金额", "收费", "平均延迟"] : ["模型", "Provider", "请求", "成功率", "Tokens", "平台基础金额", "收费"]).map((label) => <th key={label} className="whitespace-nowrap px-3 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</th>)}</tr></thead><tbody>{(tab === "providers" ? data?.providerStats ?? [] : data?.modelStats ?? []).map((row) => <tr key={String(row.provider_id ?? row.model_id)} className="border-b border-border">{tab === "providers" ? <><td className="px-3 py-3"><span className="font-semibold">{String(row.provider_name)}</span><span className="ml-2 font-mono text-[10px] text-text-tertiary">{String(row.provider_code)}</span></td><td className="px-3 py-3 font-mono">{int(row.requests)}</td><td className="px-3 py-3">{successRate(row)}</td><td className="px-3 py-3 font-mono">{tokensWithUnknown(row.tokens, row.unknown_cost_requests)}</td><td className="px-3 py-3 font-mono">{usdWithUnknown(row.provider_cost_microusd, row.unknown_cost_requests)}</td><td className="px-3 py-3 font-mono">{usdWithUnknown(row.charged_microusd, row.unknown_cost_requests)}</td><td className="px-3 py-3 font-mono">{Number(row.average_latency_ms ?? 0).toFixed(0)} ms</td></> : <><td className="px-3 py-3"><span className="font-semibold">{String(row.display_name)}</span><span className="ml-2 font-mono text-[10px] text-text-tertiary">{String(row.model_code)}</span></td><td className="px-3 py-3">{String(row.provider_code)}</td><td className="px-3 py-3 font-mono">{int(row.requests)}</td><td className="px-3 py-3">{successRate(row)}</td><td className="px-3 py-3 font-mono">{tokensWithUnknown(row.tokens, row.unknown_cost_requests)}</td><td className="px-3 py-3 font-mono">{usdWithUnknown(row.provider_cost_microusd, row.unknown_cost_requests)}</td><td className="px-3 py-3 font-mono">{usdWithUnknown(row.charged_microusd, row.unknown_cost_requests)}</td></>}</tr>)}{!(tab === "providers" ? data?.providerStats.length : data?.modelStats.length) ? <tr><td colSpan={7} className="p-10 text-center text-sm text-text-tertiary">当前范围没有真实统计数据。</td></tr> : null}</tbody></table></div>}
    </div>{detailId ? <RequestDetail id={detailId} onClose={() => setDetailId("")} /> : null}</section>;
}
