"use client";

import { type CrudFilter, useCan, useInvalidate, useList } from "@refinedev/core";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

function usd(value: unknown) {
  try {
    const micros = BigInt(String(value ?? 0));
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return `$${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "—";
  }
}

function localDateTime(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function PricingEndDialog({
  record,
  onClose,
  onSaved,
}: {
  record: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState("disabled");
  const [effectiveTo, setEffectiveTo] = useState(localDateTime(new Date()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/pricing-rules/${encodeURIComponent(String(record.id))}`, {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          status,
          effectiveTo: new Date(effectiveTo).toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? `操作失败（HTTP ${response.status}）`);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog ref={ref} className="admin-dialog admin-dialog--modal" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="admin-dialog-frame">
        <header className="admin-dialog-header"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Pricing lifecycle</p><h2 className="mt-2 font-display text-2xl font-semibold">结束价格版本</h2><p className="mt-2 font-mono text-[11px] text-text-tertiary">{String(record.model_code)} · {String(record.user_tier)}</p></div><button type="button" onClick={onClose} className="min-h-11 border border-border px-4 text-sm">关闭</button></header>
        <div className="admin-dialog-body space-y-5">
          <p className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary">历史四类 Token 价格和生效时间不会被修改。此操作只关闭当前有效窗口；调价请创建新版本。</p>
          <label className="block text-xs font-semibold text-text-secondary">结束状态<select className="admin-field mt-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="disabled">停用</option><option value="active">保持 active，仅设置结束时间</option></select></label>
          <label className="block text-xs font-semibold text-text-secondary">结束时间 *<input type="datetime-local" className="admin-field mt-2 text-sm" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} required /></label>
          {error ? <p className="border border-danger/35 bg-danger-light p-3 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
        <footer className="admin-dialog-footer"><button type="button" onClick={onClose} className="min-h-11 border border-border px-4 text-sm">取消</button><button type="button" disabled={pending || !effectiveTo} onClick={submit} className="min-h-11 bg-danger px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "处理中…" : "确认结束版本"}</button></footer>
      </div>
    </dialog>
  );
}

export default function AIPricingTimeline() {
  const pageSize = 20;
  const invalidate = useInvalidate();
  const access = useCan({ resource: "pricing-rules", action: "create" });
  const [model, setModel] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [ending, setEnding] = useState<Record<string, unknown> | null>(null);
  const filters = useMemo<CrudFilter[]>(() => [
    model && { field: "model_code", operator: "contains" as const, value: model },
    tier && { field: "user_tier", operator: "eq" as const, value: tier },
    status && { field: "status", operator: "eq" as const, value: status },
  ].filter(Boolean) as CrudFilter[], [model, status, tier]);
  const { result, query } = useList<Record<string, unknown>>({ resource: "pricing-rules", pagination: { currentPage: page, pageSize }, sorters: [{ field: "effective_from", order: "desc" }], filters });
  async function refresh() {
    await invalidate({ resource: "pricing-rules", invalidates: ["list", "detail"] });
    await query.refetch();
  }
  return (
    <section className="admin-panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4 sm:p-5"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Versioned model pricing</p><h2 className="mt-2 font-display text-2xl font-semibold">模型定价</h2><p className="mt-1 text-sm text-text-secondary">cc-switch 四类 Token 配置方式；PostgreSQL 中只追加价格版本。</p></div>{access.data?.can ? <Link href="/admin/models/pricing/new" className="inline-flex min-h-12 items-center rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-soft">＋ 创建价格版本</Link> : null}</header>
      <div className="grid gap-3 border-b border-border bg-bg-secondary/35 p-4 sm:grid-cols-3"><input className="admin-field min-h-12 rounded-2xl bg-bg-surface text-sm" value={model} onChange={(event) => { setModel(event.target.value); setPage(1); }} placeholder="模型 alias" aria-label="筛选模型 alias" /><input className="admin-field min-h-12 rounded-2xl bg-bg-surface text-sm" value={tier} onChange={(event) => { setTier(event.target.value); setPage(1); }} placeholder="用户层级" aria-label="筛选用户层级" /><select className="admin-field min-h-12 rounded-2xl bg-bg-surface text-sm" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="筛选价格状态"><option value="">全部状态</option><option value="active">Active</option><option value="disabled">Disabled</option></select></div>
      {query.error ? <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{query.error.message}</div> : null}
      <div className="max-w-full overflow-x-auto"><table className="min-w-[1080px] w-full text-left text-sm"><thead><tr className="border-b border-border bg-bg-secondary/45">{["模型 / Tier", "Input", "Output", "Cache read", "Cache write", "Markup / Discount", "生效窗口", "状态", "操作"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</th>)}</tr></thead><tbody>{query.isLoading ? Array.from({ length: 5 }).map((_, index) => <tr key={index}><td colSpan={9} className="border-b border-border px-4 py-4"><span className="block h-4 animate-pulse bg-bg-secondary" /></td></tr>) : result.data.map((row) => <tr key={String(row.id)} className="border-b border-border"><td className="px-4 py-4"><span className="block font-semibold">{String(row.model_code)}</span><span className="mt-1 block font-mono text-[10px] text-text-tertiary">{String(row.user_tier)}</span></td>{["input_price_microusd_per_million", "output_price_microusd_per_million", "cache_read_price_microusd_per_million", "cache_write_price_microusd_per_million"].map((key) => <td key={key} className="px-4 py-4 font-mono text-xs">{usd(row[key])}<span className="mt-1 block text-[9px] text-text-tertiary">/ 1M</span></td>)}<td className="px-4 py-4 font-mono text-xs">{Number(row.markup_bps ?? 0) / 100}% / {Number(row.discount_bps ?? 0) / 100}%</td><td className="px-4 py-4 text-xs"><span className="block">{new Date(String(row.effective_from)).toLocaleString("zh-CN")}</span><span className="mt-1 block text-text-tertiary">至 {row.effective_to ? new Date(String(row.effective_to)).toLocaleString("zh-CN") : "持续有效"}</span></td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${row.status === "active" ? "border-success/35 bg-success-light text-success" : "border-border bg-bg-secondary text-text-tertiary"}`}>{String(row.status)}</span></td><td className="px-4 py-4"><div className="flex gap-2"><Link href={`/admin/models/pricing/new?replaces=${encodeURIComponent(String(row.id))}`} className="inline-flex min-h-10 items-center rounded-xl bg-text-primary px-3 text-xs font-semibold text-bg-surface">新版本</Link>{row.status === "active" ? <button type="button" onClick={() => setEnding(row)} className="min-h-10 rounded-xl border border-danger/35 px-3 text-xs font-semibold text-danger">结束</button> : null}</div></td></tr>)}{!query.isLoading && !query.error && result.data.length === 0 ? <tr><td colSpan={9} className="p-14 text-center"><p className="font-display text-xl font-semibold">暂无定价版本</p><p className="mt-2 text-sm text-text-tertiary">创建版本后，Gateway 才能为对应 Tier 结算。</p></td></tr> : null}</tbody></table></div>
      {!query.error && result.total > pageSize ? <nav className="flex items-center justify-between border-t border-border p-4" aria-label="定价分页"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">上一页</button><span className="font-mono text-xs text-text-tertiary">第 {page} / {Math.max(1, Math.ceil(result.total / pageSize))} 页 · 共 {result.total} 项</span><button type="button" disabled={page * pageSize >= result.total} onClick={() => setPage((current) => current + 1)} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">下一页</button></nav> : null}
      {ending ? <PricingEndDialog record={ending} onClose={() => setEnding(null)} onSaved={refresh} /> : null}
    </section>
  );
}
