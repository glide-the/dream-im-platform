"use client";
// [Input] Paginated safe model/provider/policy DTOs and models.write authority.
// [Output] Independent routing list, registered upstream selection, CAS editing and live request-rule/sequence preview.
// [Pos] Routing operations UI; server validates ownership, protocol and revisions.
// [Sync] 2026-10-07: distinguish effective routing from edited previews and clear upstream selection on Provider changes.
// [Sync] 2026-10-07: split saved-policy observation from editing with real Gateway health aggregates.
import { useCan, useList, useOne } from "@refinedev/core";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import type { RoutingConfig } from "@/lib/models/routing-policy";
import { adminDataProvider } from "./providers";
import RoutingUpstreamModelSelect from "./RoutingUpstreamModelSelect";
import RoutingRequestPreview from "./RoutingRequestPreview";
import RoutingPolicyHealthView from "./RoutingPolicyHealthView";
import { routingPreview, type RoutingModelOption, type RoutingProviderOption } from "./routingPreview";

type PolicyRow = { id: string; model_id: string; model_code: string; revision: number; status: "draft" | "active" | "disabled"; desired: RoutingConfig; effective: RoutingConfig | null; default_target: { providerId: string; upstreamModel: string } };
const statusLabels = { draft: "草稿", active: "启用", disabled: "停用" };
const initial: RoutingConfig = { strategy: "ordered", allowFallbacks: false, targets: [] };
const control = "mt-1 min-h-11 w-full rounded-xl border border-border bg-bg-surface px-3 text-sm";
export default function RoutingPolicyManager() {
  const [page, setPage] = useState(1);
  const [modelSearch, setModelSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<PolicyRow>();
  const [modelId, setModelId] = useState("");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<PolicyRow["status"]>("draft");
  const [desired, setDesired] = useState<RoutingConfig>(initial);
  const [selected, setSelected] = useState<PolicyRow>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const access = useCan({ resource: "routing-policies", action: "create" });
  const policies = useList<PolicyRow>({ resource: "routing-policies", pagination: { currentPage: page, pageSize: 20 }, sorters: [{ field: "updated_at", order: "desc" }] });
  const models = useList<RoutingModelOption>({ resource: "models", pagination: { currentPage: 1, pageSize: 100 }, filters: modelSearch ? [{ field: "code", operator: "contains", value: modelSearch }] : [], queryOptions: { enabled: editing } });
  const providers = useList<RoutingProviderOption>({ resource: "providers", pagination: { currentPage: 1, pageSize: 100 }, filters: providerSearch ? [{ field: "name", operator: "contains", value: providerSearch }] : [], queryOptions: { enabled: editing } });
  const modelDetail = useOne<RoutingModelOption>({ resource: "models", id: modelId, queryOptions: { enabled: editing && Boolean(modelId) } });
  const alias = modelDetail.result?.id === modelId ? modelDetail.result : undefined;
  const defaultTarget = alias ? { providerId: alias.provider_id, upstreamModel: alias.upstream_model } : selected?.default_target;
  // Only configured/default Provider identities are hydrated; never fetch an unbounded catalog.
  const providerIds = [...new Set([defaultTarget?.providerId, ...desired.targets.map(value => value.providerId), ...(selected?.effective?.targets.map(value => value.providerId) ?? [])].filter((id): id is string => Boolean(id)))];
  const providerDetails = useQueries({ queries: providerIds.map(id => ({
    queryKey: ["routing-preview-provider", id], enabled: editing,
    queryFn: async () => (await adminDataProvider.getOne<RoutingProviderOption>({ resource: "providers", id })).data,
  })) });
  const providerDirectory = [...new Map([...providers.result.data, ...providerDetails.flatMap(query => query.data ? [query.data] : [])].map(value => [value.id, value])).values()];
  const defaultProvider = providerDirectory.find(value => value.id === defaultTarget?.providerId);
  const availableProviders = defaultProvider ? providerDirectory.filter(value => value.status !== "deleted" && value.protocol === defaultProvider.protocol && value.adapter_kind === defaultProvider.adapter_kind) : [];
  const providerName = (id: string) => providerDirectory.find(value => value.id === id)?.name ?? id;
  const dirty = !selected || selected.status !== status || JSON.stringify(selected.desired) !== JSON.stringify(desired);
  function edit(row?: PolicyRow) {
    setViewing(undefined); setEditing(true); setSelected(row); setModelId(row?.model_id ?? ""); setRevision(row?.revision ?? 0);
    setStatus(row?.status ?? "draft"); setDesired(row ? structuredClone(row.desired) : { ...initial, targets: [] });
    setError(""); setMessage("");
  }
  function target(index: number, patch: Partial<RoutingConfig["targets"][number]>) {
    setDesired((current) => ({ ...current, targets: current.targets.map((value, position) => position === index ? { ...value, ...patch } : value) }));
  }
  function move(index: number, offset: number) {
    setDesired((current) => { const targets = [...current.targets]; [targets[index], targets[index + offset]] = [targets[index + offset], targets[index]]; return { ...current, targets }; });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!alias || !defaultTarget) { setError("请等待当前模型目录读取完成后保存"); return; }
    setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/routing-policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId, expectedRevision: revision, status, desired }) });
      const body: { data?: Omit<PolicyRow, "model_code" | "default_target">; error?: { message?: string } } = await response.json();
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "策略保存失败");
      setRevision(body.data.revision); setSelected({ ...body.data, model_code: selected?.model_code ?? alias?.code ?? "", default_target: defaultTarget });
      setDesired(body.data.desired); setStatus(body.data.status);
      setMessage(status === "active" ? `已启用，版本 ${body.data.revision} 对新请求生效` : `已保存${statusLabels[status]}，新请求使用默认 Provider`);
      await policies.query.refetch();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setPending(false); }
  }
  return <div className="space-y-5">
    <section className="admin-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">模型路由策略</h2><p className="mt-2 text-sm text-text-secondary">为同一模型配置多个上游账号；未启用策略时使用模型的默认 Provider。</p></div>
        {access.data?.can ? <button className="min-h-11 rounded-xl bg-text-primary px-4 text-sm font-semibold text-bg-surface" onClick={() => edit()}>添加路由策略</button> : null}</div>
      {policies.query.isLoading ? <p role="status" className="mt-4">正在读取策略…</p> : null}
      {policies.query.error ? <p role="alert" className="mt-4 text-danger">{policies.query.error.message}</p> : null}
      <div className="mt-4 max-w-full overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr>{["模型", "状态", "选择方式", "策略候选", "版本", "操作"].map((label) => <th key={label} className="border-b border-border px-3 py-3 text-xs text-text-tertiary">{label}</th>)}</tr></thead><tbody>
        {policies.result.data.map((row) => <tr key={row.id}><td className="border-b border-border px-3 py-4 font-semibold">{row.model_code}</td><td className="border-b border-border px-3 py-4">{statusLabels[row.status]}</td><td className="border-b border-border px-3 py-4">{row.effective?.strategy === "weighted" ? "权重分流" : row.effective ? "按序选择" : "默认 Provider"}</td><td className="border-b border-border px-3 py-4">{row.effective?.targets.length ?? 1}</td><td className="border-b border-border px-3 py-4 font-mono">{row.revision}</td><td className="border-b border-border px-3 py-4"><div className="flex gap-2"><button type="button" className="min-h-10 rounded-xl border border-border px-3 text-xs" onClick={() => { setEditing(false); setViewing(row); }}>查看</button>{access.data?.can ? <button type="button" className="min-h-10 rounded-xl border border-border px-3 text-xs" onClick={() => edit(row)}>编辑</button> : null}</div></td></tr>)}
      </tbody></table></div>
      {!policies.query.isLoading && !policies.query.error && !policies.result.data.length ? <p className="py-8 text-center text-text-tertiary">暂无路由策略，可为已有模型添加候选 Provider。</p> : null}
      {policies.result.total > 20 ? <nav className="mt-4 flex items-center gap-3" aria-label="路由策略分页"><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 20 >= policies.result.total} onClick={() => setPage(page + 1)}>下一页</button></nav> : null}
    </section>
    {viewing ? <RoutingPolicyHealthView key={viewing.model_id} modelId={viewing.model_id} modelCode={viewing.model_code} onClose={() => setViewing(undefined)} onEdit={access.data?.can ? () => edit(viewing) : undefined} /> : null}
    {editing ? <form onSubmit={save} className="admin-panel space-y-5 p-5" aria-label="路由策略编辑">
      <div className="flex items-center justify-between"><h2 className="font-display text-xl font-semibold">{revision ? "路由策略详情" : "添加路由策略"}</h2><button type="button" onClick={() => setEditing(false)} className="min-h-10 px-3 text-sm">关闭</button></div>
      {message ? <p role="status" className="text-success">{message}</p> : null}{error ? <p role="alert" className="text-danger">{error}</p> : null}
      <fieldset disabled={pending || !access.data?.can} className="space-y-5 disabled:opacity-75">
        <div className="grid gap-4 sm:grid-cols-2">
          {!revision ? <label className="text-sm">搜索模型<input className={control} value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="按模型别名搜索" /></label> : null}
          <label className="text-sm">模型<select className={control} required value={modelId} disabled={revision > 0} onChange={(event) => { const id = event.target.value; setModelId(id); const model = models.result.data.find((value) => value.id === id); setDesired((current) => ({ ...current, targets: model ? [{ providerId: String(model.provider_id), upstreamModel: String(model.upstream_model), weight: 1 }] : [] })); }}>
            <option value="">选择模型</option>{selected && !models.result.data.some((value) => value.id === selected.model_id) ? <option value={selected.model_id}>{selected.model_code}</option> : null}{models.result.data.map((model) => <option key={String(model.id)} value={String(model.id)}>{String(model.code)}</option>)}
          </select></label>
          <label className="text-sm">策略状态<select className={control} value={status} onChange={(event) => setStatus(event.target.value as PolicyRow["status"])}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-sm">选择方式<select className={control} value={desired.strategy} onChange={(event) => setDesired({ ...desired, strategy: event.target.value as RoutingConfig["strategy"] })}><option value="ordered">按序选择</option><option value="weighted">权重分流</option></select></label>
        </div>
        {models.query.error || providers.query.error ? <p role="alert" className="text-danger">候选目录读取失败，请检查模型和 Provider 读取权限</p> : null}
        {modelDetail.query.error ? <p role="alert" className="text-danger">当前模型读取失败，无法确认候选能力。<button type="button" className="ml-2 underline" onClick={() => void modelDetail.query.refetch()}>重新读取</button></p> : null}
        {models.result.total > 100 ? <p className="text-xs text-text-tertiary">模型较多，请搜索所需别名。</p> : null}
        <label className="block text-sm">搜索 Provider<input className={control} value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder="按 Provider 名称搜索" /></label>
        <div className="space-y-3">{desired.targets.map((value, index) => <fieldset key={index} className="rounded-xl border border-border p-4"><legend className="px-2 text-xs font-semibold">候选 {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Provider<select className={control} required value={value.providerId} disabled={!alias || !defaultProvider} onChange={(event) => target(index, { providerId: event.target.value, upstreamModel: "" })}><option value="">选择 Provider</option>{value.providerId && !availableProviders.some(provider => provider.id === value.providerId) ? <option value={value.providerId} disabled>{providerName(value.providerId)}（当前候选需核对）</option> : null}{availableProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · {provider.protocol}{provider.status !== "active" ? "（停用）" : ""}</option>)}</select></label>
          <RoutingUpstreamModelSelect key={`${index}:${value.providerId}`} providerId={value.providerId} alias={alias} value={value.upstreamModel} onChange={upstreamModel => target(index, { upstreamModel })} />
          {desired.strategy === "weighted" ? <label className="text-sm">权重<input className={control} type="number" min={1} max={1_000_000} step={1} required value={value.weight} onChange={(event) => target(index, { weight: Number(event.target.value) })} /></label> : null}
        </div><div className="mt-3 flex gap-2"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="min-h-10 px-3 text-xs disabled:opacity-40">上移</button><button type="button" disabled={index === desired.targets.length - 1} onClick={() => move(index, 1)} className="min-h-10 px-3 text-xs disabled:opacity-40">下移</button><button type="button" onClick={() => setDesired({ ...desired, targets: desired.targets.filter((_, position) => position !== index) })} className="min-h-10 px-3 text-xs text-danger">移除</button></div></fieldset>)}</div>
        <button type="button" onClick={() => setDesired({ ...desired, targets: [...desired.targets, { providerId: "", upstreamModel: "", weight: 1 }] })} className="min-h-11 rounded-xl border border-border px-4 text-sm">添加候选 Provider</button>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={desired.allowFallbacks} onChange={(event) => setDesired({ ...desired, allowFallbacks: event.target.checked })} />允许明确上游拒绝后的后备选择</label>
        <p className="text-xs leading-5 text-text-tertiary">候选必须提供同一模型并支持相同能力。按序选择优先第一项；权重只影响首选。超时、执行状态不明或流式响应开始后不切换。</p>
        <button type="submit" disabled={!alias || !routingPreview(desired).valid} className="min-h-11 rounded-xl bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "保存中…" : "保存策略"}</button>
      </fieldset>
      <RoutingRequestPreview desired={desired} status={status} effective={selected?.effective} revision={revision} dirty={dirty} defaultTarget={defaultTarget} modelCode={alias?.code ?? selected?.model_code ?? ""} providerName={providerName} />
    </form> : null}
  </div>;
}
