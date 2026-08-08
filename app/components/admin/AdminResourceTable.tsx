"use client";

import { useList } from "@refinedev/core";
import { useState } from "react";

type Column = {
  key: string;
  label: string;
  format?: "money" | "date" | "boolean" | "json" | "status";
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

function renderValue(value: unknown, format?: Column["format"]) {
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

export default function AdminResourceTable({
  resource,
  title,
  description,
  columns,
  defaultSort = "created_at",
  pageSize = 12,
}: {
  resource: string;
  title: string;
  description: string;
  columns: Column[];
  defaultSort?: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const { result, query } = useList<Record<string, unknown>>({
    resource,
    pagination: { currentPage: page, pageSize },
    sorters: [{ field: defaultSort, order: "desc" }],
  });
  const pages = Math.max(1, Math.ceil((result.total ?? 0) / pageSize));

  return (
    <section className="overflow-hidden rounded-[24px] border border-border bg-bg-surface shadow-subtle">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-5 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {query.isFetching ? "syncing" : `${result.total ?? 0} records`}
        </span>
      </header>

      {query.error ? (
        <div className="m-5 rounded-xl bg-danger-light p-4 text-sm text-danger">
          {query.error.message}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/60">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="whitespace-nowrap px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data.map((row, index) => (
              <tr
                key={String(row.id ?? index)}
                className="border-b border-border last:border-0"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`max-w-[320px] px-5 py-4 text-text-secondary ${
                      column.key === "id" ? "font-mono text-[11px]" : ""
                    }`}
                  >
                    <span
                      className={
                        column.format === "status"
                          ? "inline-flex rounded-full bg-bg-secondary px-2.5 py-1 text-xs font-semibold text-text-primary"
                          : "block truncate"
                      }
                      title={renderValue(row[column.key], column.format)}
                    >
                      {renderValue(row[column.key], column.format)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            {!query.isLoading && result.data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-12 text-center text-sm text-text-tertiary"
                >
                  暂无数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-between border-t border-border px-5 py-4">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          className="min-h-10 rounded-full border border-border px-4 text-xs font-semibold disabled:opacity-40"
        >
          上一页
        </button>
        <span className="font-mono text-[10px] text-text-tertiary">
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => setPage((value) => Math.min(pages, value + 1))}
          className="min-h-10 rounded-full border border-border px-4 text-xs font-semibold disabled:opacity-40"
        >
          下一页
        </button>
      </footer>
    </section>
  );
}
