"use client";

import { type CrudFilter, useList } from "@refinedev/core";
import { FormEvent, useMemo, useState } from "react";

export type AdminTableColumn = {
  key: string;
  label: string;
  format?: "money" | "date" | "boolean" | "json" | "status";
};

type FilterDefinition = {
  field: string;
  label: string;
  operator?: "eq" | "contains";
  options?: Array<{ label: string; value: string }>;
};

function formatMoney(value: unknown) {
  try {
    const micros = BigInt(String(value ?? 0));
    const sign = micros < 0n ? "-" : "";
    const absolute = micros < 0n ? -micros : micros;
    const dollars = absolute / 1_000_000n;
    const fraction = (absolute % 1_000_000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "") || "00";
    return `${sign}$${dollars}.${fraction}`;
  } catch {
    return "—";
  }
}

function renderValue(value: unknown, format?: AdminTableColumn["format"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "money") return formatMoney(value);
  if (format === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN");
  }
  if (format === "boolean") return value ? "启用" : "停用";
  if (format === "json") return JSON.stringify(value);
  return String(value);
}

function statusClass(value: unknown) {
  const status = String(value ?? "").toLowerCase();
  if (["active", "enabled", "confirmed", "completed", "published", "success", "settled"].includes(status)) {
    return "border-success/35 bg-success-light text-success";
  }
  if (["failed", "rejected", "disabled", "closed", "cancelled", "settlement_failed"].includes(status)) {
    return "border-danger/35 bg-danger-light text-danger";
  }
  return "border-border bg-bg-secondary text-text-secondary";
}

export default function AdminResourceTable({
  resource,
  title,
  description,
  columns,
  defaultSort = "created_at",
  pageSize = 12,
  filters: filterDefinitions = [],
  defaultFilters = [],
}: {
  resource: string;
  title: string;
  description: string;
  columns: AdminTableColumn[];
  defaultSort?: string;
  pageSize?: number;
  filters?: FilterDefinition[];
  defaultFilters?: CrudFilter[];
}) {
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [appliedFilters, setAppliedFilters] = useState<CrudFilter[]>(defaultFilters);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const { result, query } = useList<Record<string, unknown>>({
    resource,
    pagination: { currentPage: page, pageSize },
    sorters: [{ field: defaultSort, order: "desc" }],
    filters: appliedFilters,
  });
  const pages = Math.max(1, Math.ceil((result.total ?? 0) / pageSize));
  const detailEntries = useMemo(
    () => selected ? Object.entries(selected).filter(([key]) => !["password_hash", "api_key_ciphertext", "api_key_iv", "api_key_tag"].includes(key)) : [],
    [selected],
  );

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setAppliedFilters([
      ...defaultFilters,
      ...filterDefinitions.flatMap((filter) => {
        const value = draftFilters[filter.field]?.trim();
        return value ? [{ field: filter.field, operator: filter.operator ?? "contains", value } as CrudFilter] : [];
      }),
    ]);
    setPage(1);
  }

  function clearFilters() {
    setDraftFilters({});
    setAppliedFilters(defaultFilters);
    setPage(1);
  }

  return (
    <section className="admin-panel min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-5">
        <div className="max-w-3xl">
          <h2 className="font-display text-xl font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary" aria-live="polite">
          {query.isFetching ? "正在同步" : `${result.total ?? 0} 条记录`}
        </span>
      </header>

      {filterDefinitions.length ? (
        <form onSubmit={applyFilters} className="grid gap-3 border-b border-border bg-bg-secondary/45 p-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(150px,1fr))_auto]">
          {filterDefinitions.map((filter) => (
            <label key={filter.field} className="text-xs font-semibold text-text-secondary">
              {filter.label}
              {filter.options ? (
                <select className="admin-field mt-1 block text-sm" value={draftFilters[filter.field] ?? ""} onChange={(event) => setDraftFilters((value) => ({ ...value, [filter.field]: event.target.value }))}>
                  <option value="">全部</option>
                  {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input className="admin-field mt-1 block text-sm" value={draftFilters[filter.field] ?? ""} onChange={(event) => setDraftFilters((value) => ({ ...value, [filter.field]: event.target.value }))} placeholder={`筛选${filter.label}`} />
              )}
            </label>
          ))}
          <div className="flex items-end gap-2">
            <button type="submit" className="min-h-11 bg-text-primary px-4 text-sm font-semibold text-bg-surface">应用</button>
            <button type="button" onClick={clearFilters} className="min-h-11 border border-border bg-bg-surface px-4 text-sm text-text-secondary">清除</button>
          </div>
        </form>
      ) : null}

      {query.error ? (
        <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">
          <p className="font-semibold">数据暂时不可用</p>
          <p className="mt-1">{query.error.message}</p>
          <button type="button" onClick={() => query.refetch()} className="mt-3 min-h-10 underline">重新加载</button>
        </div>
      ) : null}

      <div className="max-w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/45">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{column.label}</th>
              ))}
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">详情</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? Array.from({ length: 5 }).map((_, index) => (
              <tr key={index} className="border-b border-border" aria-hidden="true">
                <td colSpan={columns.length + 1} className="px-4 py-4"><span className="block h-4 w-full max-w-3xl animate-pulse bg-bg-secondary" /></td>
              </tr>
            )) : null}
            {result.data.map((row, index) => (
              <tr key={String(row.id ?? index)} className="border-b border-border last:border-0 hover:bg-bg-secondary/35">
                {columns.map((column) => (
                  <td key={column.key} className={`max-w-[320px] px-4 py-3.5 text-text-secondary ${column.key === "id" ? "font-mono text-[11px]" : ""}`}>
                    <span className={column.format === "status" ? `inline-flex whitespace-nowrap border px-2 py-1 text-xs font-semibold ${statusClass(row[column.key])}` : "block truncate"} title={renderValue(row[column.key], column.format)}>{renderValue(row[column.key], column.format)}</span>
                  </td>
                ))}
                <td className="px-4 py-3.5 text-right"><button type="button" onClick={() => setSelected(row)} className="min-h-10 px-2 text-xs font-semibold text-text-secondary underline decoration-border" aria-label={`查看 ${String(row.id ?? "记录")} 详情`}>查看</button></td>
              </tr>
            ))}
            {!query.isLoading && !query.error && result.data.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-5 py-14 text-center"><p className="font-display text-lg font-semibold">暂无匹配记录</p><p className="mt-2 text-sm text-text-tertiary">清除筛选条件，或等待业务源产生数据。</p></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-between border-t border-border px-4 py-4">
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">上一页</button>
        <span className="font-mono text-[10px] text-text-tertiary">第 {page} / {pages} 页</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">下一页</button>
      </footer>

      {selected ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={`${resource}-detail-title`}>
          <button type="button" className="absolute inset-0 bg-black/35" onClick={() => setSelected(null)} aria-label="关闭详情" />
          <aside className="absolute inset-y-0 right-0 w-[min(94vw,620px)] overflow-y-auto border-l border-border bg-bg-surface p-5 shadow-medium sm:p-7">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
              <div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Record detail</p><h2 id={`${resource}-detail-title`} className="mt-2 font-display text-2xl font-semibold">{title}</h2><p className="mt-2 break-all font-mono text-[11px] text-text-tertiary">{String(selected.id ?? "—")}</p></div>
              <button type="button" onClick={() => setSelected(null)} className="min-h-11 border border-border px-4 text-sm">关闭</button>
            </div>
            <dl className="divide-y divide-border">
              {detailEntries.map(([key, value]) => (
                <div key={key} className="grid gap-2 py-4 sm:grid-cols-[150px_1fr]"><dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{key}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{typeof value === "object" ? JSON.stringify(value, null, 2) : renderValue(value)}</dd></div>
              ))}
            </dl>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
