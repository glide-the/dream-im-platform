// [Input] Refine model catalog rows, filters, validation state, and operator navigation.
// [Output] Model cards with safe Gateway capabilities and optional Claude Code Runtime values.
// [Pos] Admin model-registry list; edits remain in the shared resource form/API boundary.
// [Sync] 2026-08-28: display configured compact/context Runtime values without exposing env implementation names.

"use client";

import { type CrudFilter, useCan, useList } from "@refinedev/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AdminCollapsibleFilters, AdminListHeader, countActiveFilterValues } from "./AdminListChrome";

type ValidationState = {
  pending?: boolean;
  status?: "operational" | "degraded" | "failed";
  usable?: boolean;
  responseTimeMs?: number | null;
  httpStatus?: number | null;
  message?: string;
};

function capabilityLabels(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const labels: Record<string, string> = {
    chat: "Chat",
    streaming: "Streaming",
    tools: "Tool Use",
    vision: "Vision",
    json: "JSON",
  };
  return Object.entries(value as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => labels[key] ?? key);
}

export default function AIModelRegistry() {
  const pageSize = 12;
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [enabled, setEnabled] = useState("");
  const [providerId, setProviderId] = useState(searchParams.get("provider_id") ?? "");
  const [page, setPage] = useState(1);
  const [validation, setValidation] = useState<Record<string, ValidationState>>({});
  const access = useCan({ resource: "models", action: "create" });
  const providers = useList<Record<string, unknown>>({
    resource: "providers",
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: "name", order: "asc" }],
  });
  const filters = useMemo<CrudFilter[]>(
    () =>
      [
        search && { field: "search", operator: "contains" as const, value: search },
        enabled && { field: "enabled", operator: "eq" as const, value: enabled },
        providerId && { field: "provider_id", operator: "eq" as const, value: providerId },
      ].filter(Boolean) as CrudFilter[],
    [enabled, providerId, search],
  );
  const { result, query } = useList<Record<string, unknown>>({
    resource: "models",
    pagination: { currentPage: page, pageSize },
    sorters: [{ field: "updated_at", order: "desc" }],
    filters,
  });

  async function validateModel(modelId: string) {
    setValidation((current) => ({ ...current, [modelId]: { pending: true, message: "正在验证已保存凭据与上游模型…" } }));
    try {
      const response = await fetch(`/api/admin/models/${encodeURIComponent(modelId)}/validate`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as { data?: ValidationState; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "模型验证失败");
      setValidation((current) => ({ ...current, [modelId]: body.data ?? {} }));
    } catch (error) {
      setValidation((current) => ({
        ...current,
        [modelId]: { status: "failed", usable: false, message: error instanceof Error ? error.message : "模型验证失败" },
      }));
    }
  }

  return (
    <section className="admin-panel overflow-hidden">
      <AdminListHeader eyebrow="Model alias registry" title="模型" description="外部请求只使用稳定 alias；上游型号留在 Provider 路由内部。" actions={access.data?.can ? <Link href={`/admin/models/models/new${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`} className="inline-flex min-h-11 items-center bg-accent px-4 text-sm font-semibold text-white">＋ 添加模型</Link> : null} />
      <AdminCollapsibleFilters activeCount={countActiveFilterValues({ search, providerId, enabled })}>
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,320px)_180px]">
          <label><span className="sr-only">搜索模型</span><input className="admin-field text-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索名称、alias 或上游型号" /></label>
          <select className="admin-field text-sm" value={providerId} onChange={(event) => { setProviderId(event.target.value); setPage(1); }} aria-label="Provider 筛选"><option value="">全部 Provider</option>{providers.result.data.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.name)} · {String(provider.code)}</option>)}</select>
          <select className="admin-field text-sm" value={enabled} onChange={(event) => { setEnabled(event.target.value); setPage(1); }} aria-label="模型状态筛选"><option value="">全部状态</option><option value="true">启用</option><option value="false">停用</option></select>
        </div>
      </AdminCollapsibleFilters>
      {query.error ? <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert"><p className="font-semibold">模型注册表暂不可用</p><p className="mt-1">{query.error.message}</p></div> : null}
      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
        {query.isLoading ? Array.from({ length: 4 }).map((_, index) => <span key={index} className="h-56 animate-pulse rounded-2xl border border-border bg-bg-secondary" />) : null}
        {result.data.map((model) => {
          const capabilities = capabilityLabels(model.capabilities);
          const modelId = String(model.id);
          const validationResult = validation[modelId];
          const runtimeReady = model.provider_ready === true
            && model.pricing_ready === true;
          return (
            <article key={String(model.id)} className="rounded-2xl border border-border bg-bg-surface p-5 shadow-soft">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{String(model.provider_code)}</p><h3 className="mt-2 truncate text-lg font-semibold">{String(model.display_name)}</h3><p className="mt-1 truncate font-mono text-xs text-accent">{String(model.code)}</p></div>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${model.enabled ? "border-success/35 bg-success-light text-success" : "border-border bg-bg-secondary text-text-tertiary"}`}>{model.enabled ? "已启用" : "已停用"}</span>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-border py-4 text-xs">
                <div><dt className="text-text-tertiary">上游型号</dt><dd className="mt-1 break-all font-mono text-[11px]">{String(model.upstream_model)}</dd></div>
                <div><dt className="text-text-tertiary">Context / Max output</dt><dd className="mt-1 font-mono text-[11px]">{model.context_window ? Number(model.context_window).toLocaleString("zh-CN") : "—"} / {model.max_output_tokens ? Number(model.max_output_tokens).toLocaleString("zh-CN") : "—"}</dd></div>
                <div className="col-span-2"><dt className="text-text-tertiary">Claude Code 自动压缩 / 最大上下文</dt><dd className="mt-1 font-mono text-[11px]">{model.claude_code_auto_compact_window ? Number(model.claude_code_auto_compact_window).toLocaleString("zh-CN") : "—"} / {model.claude_code_max_context_tokens ? Number(model.claude_code_max_context_tokens).toLocaleString("zh-CN") : "—"}</dd></div>
              </dl>
              <div className="mt-4 flex min-h-8 flex-wrap gap-2">{capabilities.length ? capabilities.map((label) => <span key={label} className="rounded-full bg-bg-secondary px-2.5 py-1 text-[10px] text-text-secondary">{label}</span>) : <span className="text-xs text-text-tertiary">未声明能力</span>}</div>
              {model.enabled ? <p className={`mt-3 text-xs ${runtimeReady ? "text-success" : "text-accent-orange"}`}>
                {runtimeReady
                  ? `公共目录可见 · 用户具备有效 Token 额度时可调用${model.published_messages_entitlement === true ? " · 已配置套餐级模型限额" : " · 未配置套餐级模型限额"}。`
                  : `公共目录可见 · 运行配置待修复${model.provider_ready !== true ? " · Provider未就绪" : ""}${model.pricing_ready !== true ? " · 缺有效定价" : ""}`}
              </p> : <p className="mt-3 text-xs text-text-tertiary">公共目录不可见 · 模型已停用。</p>}
              {validationResult?.message ? <p className={`mt-3 text-xs ${validationResult.status === "failed" ? "text-danger" : validationResult.status === "degraded" ? "text-accent-orange" : "text-success"}`} role="status">{validationResult.message}{validationResult.responseTimeMs !== undefined && validationResult.responseTimeMs !== null ? ` · ${validationResult.responseTimeMs} ms` : ""}{validationResult.httpStatus ? ` · HTTP ${validationResult.httpStatus}` : ""}</p> : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {access.data?.can ? <button type="button" disabled={validationResult?.pending} onClick={() => validateModel(modelId)} className="min-h-10 rounded-xl border border-border px-3 text-xs font-semibold disabled:cursor-wait disabled:opacity-60" title="发送一次非流式、最多 1 Token 的上游验证请求；不保存提示词或响应内容">{validationResult?.pending ? "验证中…" : "验证配置"}</button> : null}
                <Link href={`/admin/models/pricing/new?modelId=${encodeURIComponent(String(model.id))}`} className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold">添加定价</Link>
                <Link href={`/admin/billing/usage?modelId=${encodeURIComponent(String(model.id))}`} className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold">查看用量</Link>
                <Link href={`/admin/models/models/${encodeURIComponent(String(model.id))}/edit`} className="inline-flex min-h-10 items-center rounded-xl bg-text-primary px-4 text-xs font-semibold text-bg-surface">模型设置</Link>
              </div>
            </article>
          );
        })}
        {!query.isLoading && !query.error && result.data.length === 0 ? <div className="py-16 text-center xl:col-span-2"><p className="font-display text-xl font-semibold">没有匹配模型</p><p className="mt-2 text-sm text-text-tertiary">从 Provider 添加稳定模型 alias。</p></div> : null}
        {!query.error && result.total > pageSize ? <nav className="flex items-center justify-between border-t border-border pt-4 xl:col-span-2" aria-label="模型分页"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 rounded-xl border border-border px-4 text-xs font-semibold disabled:opacity-40">上一页</button><span className="font-mono text-xs text-text-tertiary">第 {page} / {Math.max(1, Math.ceil(result.total / pageSize))} 页 · 共 {result.total} 项</span><button type="button" disabled={page * pageSize >= result.total} onClick={() => setPage((current) => current + 1)} className="min-h-10 rounded-xl border border-border px-4 text-xs font-semibold disabled:opacity-40">下一页</button></nav> : null}
      </div>
    </section>
  );
}
