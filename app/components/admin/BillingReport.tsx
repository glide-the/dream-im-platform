"use client";

import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type ReportRow = Record<string, string> & { day: string };

function defaultRange() {
  const today = new Date();
  return { to: today.toISOString().slice(0, 10), from: new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10) };
}

export default function BillingReport() {
  const initial = defaultRange();
  const [draft, setDraft] = useState(initial);
  const [range, setRange] = useState(initial);
  const query = useQuery({
    queryKey: ["billing-report", range],
    queryFn: async () => {
      const response = await fetch(`/api/admin/billing-report?from=${range.from}&to=${range.to}`, { headers: { accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "计费报表加载失败");
      return body.data as ReportRow[];
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setRange(draft);
  }

  function exportCsv() {
    const rows = query.data ?? [];
    const headers = ["day", "requests", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "provider_cost_microusd", "charged_microusd", "settlement_failures"];
    const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ink-memory-billing-${range.from}-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="admin-panel overflow-hidden"><header className="border-b border-border p-5"><h2 className="font-display text-xl font-semibold">按日计费报表</h2><p className="mt-1 text-sm text-text-secondary">汇总真实 Gateway 请求；范围最多 366 天。CSV 使用当前筛选结果。</p></header><form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-b border-border bg-bg-secondary/45 p-4"><label className="text-xs font-semibold text-text-secondary">开始日期<input type="date" className="admin-field mt-1 block" value={draft.from} onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} required /></label><label className="text-xs font-semibold text-text-secondary">结束日期<input type="date" className="admin-field mt-1 block" value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} required /></label><button className="min-h-11 bg-text-primary px-4 text-sm font-semibold text-bg-surface">生成报表</button><button type="button" onClick={exportCsv} disabled={!query.data?.length} className="min-h-11 border border-border bg-bg-surface px-4 text-sm disabled:opacity-40">导出 CSV</button></form>{query.error ? <p className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{query.error.message}</p> : null}<div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-border bg-bg-secondary/45">{["日期", "请求", "Input", "Output", "Cache read", "Cache write", "Provider 成本", "收费", "结算失败记录"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</th>)}</tr></thead><tbody>{query.data?.map((row) => <tr key={row.day} className="border-b border-border"><td className="px-4 py-3 font-mono text-xs">{row.day}</td><td className="px-4 py-3">{row.requests}</td><td className="px-4 py-3">{row.input_tokens}</td><td className="px-4 py-3">{row.output_tokens}</td><td className="px-4 py-3">{row.cache_read_tokens}</td><td className="px-4 py-3">{row.cache_write_tokens}</td><td className="px-4 py-3 font-mono text-xs">{row.provider_cost_microusd}</td><td className="px-4 py-3 font-mono text-xs">{row.charged_microusd}</td><td className="px-4 py-3">{row.settlement_failures}</td></tr>)}{!query.isLoading && !query.data?.length ? <tr><td colSpan={9} className="px-5 py-12 text-center text-sm text-text-tertiary">所选时间范围内没有 Gateway 请求。</td></tr> : null}</tbody></table></div></section>;
}
