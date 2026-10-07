"use client";
// [Input] Paginated safe model/provider/policy DTOs and models.write authority.
// [Output] Independent routing list, desired/default/effective detail and CAS editing.
// [Pos] Routing operations UI; server validates ownership, protocol and revisions.
import { useCan, useList } from "@refinedev/core";
import { useState } from "react";
import type { RoutingConfig } from "@/lib/models/routing-policy";

type PolicyRow = { id: string; model_id: string; model_code: string; revision: number; status: "draft" | "active" | "disabled"; desired: RoutingConfig; effective: RoutingConfig | null; default_target: { providerId: string; upstreamModel: string } };
const statusLabels = { draft: "草稿", active: "启用", disabled: "停用" };
const initial: RoutingConfig = { strategy: "ordered", allowFallbacks: false, targets: [] };
const control = "mt-1 min-h-11 w-full rounded-xl border border-border bg-bg-surface px-3 text-sm";
export default function RoutingPolicyManager() {
  const [page, setPage] = useState(1);
  const [modelSearch, setModelSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [editing, setEditing] = useState(false);
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
  const models = useList<Record<string, unknown>>({ resource: "models", pagination: { currentPage: 1, pageSize: 100 }, filters: modelSearch ? [{ field: "code", operator: "contains", value: modelSearch }] : [] });
  const providers = useList<Record<string, unknown>>({ resource: "providers", pagination: { currentPage: 1, pageSize: 100 }, filters: providerSearch ? [{ field: "name", operator: "contains", value: providerSearch }] : [] });
  function edit(row?: PolicyRow) {
    setEditing(true); setSelected(row); setModelId(row?.model_id ?? ""); setRevision(row?.revision ?? 0);
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
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/routing-policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId, expectedRevision: revision, status, desired }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "策略保存失败");
      setRevision(body.data.revision); setSelected({ ...body.data, model_code: selected?.model_code ?? String(models.result.data.find((value) => value.id === modelId)?.code ?? ""), default_target: selected?.default_target ?? { providerId: String(models.result.data.find((value) => value.id === modelId)?.provider_id ?? ""), upstreamModel: String(models.result.data.find((value) => value.id === modelId)?.upstream_model ?? "") } });
      setMessage(status === "active" ? `已启用，版本 ${body.data.revision} 对新请求生效` : `已保存${statusLabels[status]}，新请求使用默认 Provider`);
      await policies.query.refetch();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setPending(false); }
  }
  const defaultTarget = selected?.default_target ?? (() => { const model = models.result.data.find((value) => value.id === modelId); return model ? { providerId: String(model.provider_id), upstreamModel: String(model.upstream_model) } : undefined; })();
  const providerName = (id: string) => String(providers.result.data.find((value) => value.id === id)?.name ?? id);
  return <div className="space-y-5">
    <section className="admin-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">模型路由策略</h2><p className="mt-2 text-sm text-text-secondary">为同一模型配置多个上游账号；未启用策略时使用模型的默认 Provider。</p></div>
        {access.data?.can ? <button className="min-h-11 rounded-xl bg-text-primary px-4 text-sm font-semibold text-bg-surface" onClick={() => edit()}>添加路由策略</button> : null}</div>
      {policies.query.isLoading ? <p role="status" className="mt-4">正在读取策略…</p> : null}
      {policies.query.error ? <p role="alert" className="mt-4 text-danger">{policies.query.error.message}</p> : null}
      <div className="mt-4 max-w-full overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr>{["模型", "状态", "选择方式", "策略候选", "版本", "操作"].map((label) => <th key={label} className="border-b border-border px-3 py-3 text-xs text-text-tertiary">{label}</th>)}</tr></thead><tbody>
        {policies.result.data.map((row) => <tr key={row.id}><td className="border-b border-border px-3 py-4 font-semibold">{row.model_code}</td><td className="border-b border-border px-3 py-4">{statusLabels[row.status]}</td><td className="border-b border-border px-3 py-4">{row.effective?.strategy === "weighted" ? "权重分流" : row.effective ? "按序选择" : "默认 Provider"}</td><td className="border-b border-border px-3 py-4">{row.effective?.targets.length ?? 1}</td><td className="border-b border-border px-3 py-4 font-mono">{row.revision}</td><td className="border-b border-border px-3 py-4"><button className="min-h-10 rounded-xl border border-border px-3 text-xs" onClick={() => edit(row)}>{access.data?.can ? "查看 / 编辑" : "查看"}</button></td></tr>)}
      </tbody></table></div>
      {!policies.query.isLoading && !policies.query.error && !policies.result.data.length ? <p className="py-8 text-center text-text-tertiary">暂无路由策略，可为已有模型添加候选 Provider。</p> : null}
      {policies.result.total > 20 ? <nav className="mt-4 flex items-center gap-3" aria-label="路由策略分页"><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 20 >= policies.result.total} onClick={() => setPage(page + 1)}>下一页</button></nav> : null}
    </section>
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
        {models.result.total > 100 ? <p className="text-xs text-text-tertiary">模型较多，请搜索所需别名。</p> : null}
        <label className="block text-sm">搜索 Provider<input className={control} value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder="按 Provider 名称搜索" /></label>
        <div className="space-y-3">{desired.targets.map((value, index) => <fieldset key={index} className="rounded-xl border border-border p-4"><legend className="px-2 text-xs font-semibold">候选 {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Provider<select className={control} required value={value.providerId} onChange={(event) => target(index, { providerId: event.target.value })}><option value="">选择 Provider</option>{value.providerId && !providers.result.data.some((provider) => provider.id === value.providerId) ? <option value={value.providerId}>{value.providerId}</option> : null}{providers.result.data.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.name)} · {String(provider.protocol)}</option>)}</select></label>
          <label className="text-sm">上游型号<input className={control} required value={value.upstreamModel} onChange={(event) => target(index, { upstreamModel: event.target.value })} /></label>
          {desired.strategy === "weighted" ? <label className="text-sm">权重<input className={control} type="number" min={1} max={1_000_000} step={1} required value={value.weight} onChange={(event) => target(index, { weight: Number(event.target.value) })} /></label> : null}
        </div><div className="mt-3 flex gap-2"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="min-h-10 px-3 text-xs disabled:opacity-40">上移</button><button type="button" disabled={index === desired.targets.length - 1} onClick={() => move(index, 1)} className="min-h-10 px-3 text-xs disabled:opacity-40">下移</button><button type="button" onClick={() => setDesired({ ...desired, targets: desired.targets.filter((_, position) => position !== index) })} className="min-h-10 px-3 text-xs text-danger">移除</button></div></fieldset>)}</div>
        <button type="button" onClick={() => setDesired({ ...desired, targets: [...desired.targets, { providerId: "", upstreamModel: "", weight: 1 }] })} className="min-h-11 rounded-xl border border-border px-4 text-sm">添加候选 Provider</button>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={desired.allowFallbacks} onChange={(event) => setDesired({ ...desired, allowFallbacks: event.target.checked })} />允许明确上游拒绝后的后备选择</label>
        <p className="text-xs leading-5 text-text-tertiary">候选必须提供同一模型并支持相同能力。按序选择优先第一项；权重只影响首选。超时、执行状态不明或流式响应开始后不切换。</p>
        <button type="submit" disabled={!modelId || desired.targets.length === 0} className="min-h-11 rounded-xl bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "保存中…" : "保存策略"}</button>
      </fieldset>
      <div className="border-t border-border pt-4 text-sm"><p>默认 Provider：{defaultTarget ? `${providerName(defaultTarget.providerId)} · ${defaultTarget.upstreamModel}` : "先选择模型"}</p><p className="mt-2">当前有效配置：{selected?.effective ? `${selected.effective.strategy === "weighted" ? "权重分流" : "按序选择"} · ${selected.effective.targets.map((value) => providerName(value.providerId)).join(" → ")}` : "默认 Provider"}</p><p className="mt-2 text-text-tertiary">版本 {revision} · 保存启用状态后立即影响新请求；草稿或停用使用默认 Provider。</p></div>
    </form> : null}
  </div>;
}
