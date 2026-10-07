"use client";
// [Input] Selected Provider, authoritative alias capability DTO and paginated registered models.
// [Output] Searchable compatible enabled upstream-model choices without arbitrary model input.
// [Pos] Routing target editor; changing a Provider is handled by the parent and clears its model.
import { useList } from "@refinedev/core";
import { useId, useState } from "react";
import { compatibleRoutingModels, type RoutingModelOption } from "./routingPreview";

export default function RoutingUpstreamModelSelect({ providerId, alias, value, onChange }: {
  providerId: string; alias?: RoutingModelOption; value: string; onChange: (value: string) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const catalog = useList<RoutingModelOption>({
    resource: "models", pagination: { currentPage: page, pageSize },
    filters: [{ field: "provider_id", operator: "eq", value: providerId }, { field: "enabled", operator: "eq", value: "true" },
      ...(search.trim() ? [{ field: "search", operator: "contains" as const, value: search.trim() }] : [])],
    sorters: [{ field: "code", order: "asc" }], queryOptions: { enabled: Boolean(providerId && alias) },
  });
  const options = alias ? compatibleRoutingModels(alias, providerId, catalog.result.data) : [];
  const absent = Boolean(value && !options.some(model => model.upstream_model === value));
  const loading = Boolean(providerId && alias && catalog.query.isLoading);
  const unavailable = !providerId || !alias || loading || Boolean(catalog.query.error);
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm">上游型号</label>
    <select id={id} className="min-h-11 w-full rounded-xl border border-border bg-bg-surface px-3 text-sm" required value={value} disabled={unavailable} onChange={event => onChange(event.target.value)}>
      <option value="">{!providerId ? "先选择 Provider" : loading ? "正在读取可用模型…" : "选择可用上游型号"}</option>
      {absent ? <option value={value} disabled>{value}（已配置，未在本页可选项中）</option> : null}
      {options.map(model => <option key={model.upstream_model} value={model.upstream_model}>{model.upstream_model} · {model.display_name}</option>)}
    </select>
    {providerId && alias ? <>
      <input aria-label="搜索上游型号" className="min-h-10 w-full rounded-xl border border-border bg-bg-surface px-3 text-xs" placeholder="搜索上游型号或模型名称" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
      {loading ? <p role="status" className="text-xs text-text-tertiary">正在读取可用模型…</p> : null}
      {catalog.query.error ? <div role="alert" className="text-xs text-danger">上游模型目录读取失败。<button type="button" className="ml-2 underline" onClick={() => void catalog.query.refetch()}>重新读取</button></div> : null}
      {!loading && !catalog.query.error && !options.length ? <p className="text-xs text-text-secondary">{catalog.result.total > pageSize ? "本页没有符合能力要求的型号，可搜索或翻页。" : "没有符合能力要求的已启用型号，请先在模型管理中登记并启用。"}</p> : null}
      {absent && !loading && !catalog.query.error ? <p className="text-xs text-text-tertiary">已配置型号未在当前可选项中，请搜索确认；保存时会再次校验。</p> : null}
      {catalog.result.total > pageSize ? <nav aria-label="上游型号分页" className="flex items-center gap-3 text-xs"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={page * pageSize >= catalog.result.total} onClick={() => setPage(page + 1)}>下一页</button></nav> : null}
    </> : null}
  </div>;
}
