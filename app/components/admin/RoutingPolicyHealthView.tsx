"use client";
// [Input] Saved model identity and protected real Gateway health aggregates.
// [Output] Separate read-only availability, attempt-health and performance workbench.
// [Pos] Routing observation view; edit action returns to the unchanged policy editor.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { routingHealthPolicy, routingHealthWindows } from "../../../config/routing-health-policy";
import type { RoutingHealthData, RoutingHealthQuery } from "@/lib/models/routing-health-contract";
import RoutingHealthChart, { healthDuration, healthPercent, healthTime } from "./RoutingHealthChart";

const control = "min-h-11 rounded-xl border border-border bg-bg-surface px-3 text-sm";
export default function RoutingPolicyHealthView({ modelId, modelCode, onClose, onEdit }: {
  modelId: string; modelCode: string; onClose: () => void; onEdit?: () => void;
}) {
  const [window, setWindow] = useState<RoutingHealthQuery["window"]>(routingHealthPolicy.defaultWindow);
  const [page, setPage] = useState(1);
  const [metric, setMetric] = useState<"latency" | "firstToken">("latency");
  const [selectedHour, setSelectedHour] = useState<string>();
  const health = useQuery({
    queryKey: ["routing-health", modelId, window, page], refetchOnWindowFocus: false, refetchOnMount: "always", retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/admin/routing-policies/${encodeURIComponent(modelId)}/health?window=${window}&providerPage=${page}`, { signal, cache: "no-store" });
      const body: { data?: RoutingHealthData; error?: { message?: string } } = await response.json();
      if (!response.ok || !body.data) throw new Error(response.status === 403 ? "查看链路健康需要模型与 Gateway 读取权限。" : body.error?.message ?? "链路健康读取失败");
      return body.data;
    },
  });
  const data = health.data;
  const point = data?.timeline.find(value => value.at === selectedHour) ?? data?.timeline.at(-1);
  const providerName = (id: string) => data?.currentTargets.find(value => value.providerId === id)?.providerName ?? id;
  return <section className="admin-panel min-w-0 space-y-6 p-5" aria-label="路由策略查看">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-widest text-text-tertiary">Routing health</p><h2 className="mt-2 break-all font-display text-2xl font-semibold">{data?.model.displayName ?? modelCode}</h2><p className="mt-2 break-all font-mono text-xs text-text-secondary">{data?.model.code ?? modelCode}</p></div><div className="flex gap-2">{onEdit ? <button type="button" className={control} onClick={onEdit}>编辑策略</button> : null}<button type="button" className={control} onClick={onClose}>关闭查看</button></div></header>
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-3 text-sm">统计范围<select className={control} value={window} onChange={event => { setWindow(event.target.value as RoutingHealthQuery["window"]); setPage(1); setSelectedHour(undefined); }}>{routingHealthWindows.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" className={control} disabled={health.isFetching} onClick={() => void health.refetch()}>{health.isFetching ? "正在读取…" : "刷新健康数据"}</button></div>
    {health.error ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-light p-4 text-sm text-danger">{health.error.message}{data ? " 上次数据未更新，请重试。" : ""}<button type="button" className="ml-3 underline" onClick={() => void health.refetch()}>重新读取</button></p> : null}
    {health.isPending ? <p role="status" className="py-12 text-center text-sm text-text-secondary">正在读取可用性与链路健康…</p> : null}
    {data ? <>
      <div className="space-y-2 rounded-xl border border-border bg-bg-secondary p-4 text-sm">
        <p className="font-semibold">当前生效配置 · 版本 {data.policy.revision} · {data.policy.status === "active" ? "启用" : data.policy.status === "draft" ? "草稿，使用默认 Provider" : "停用，使用默认 Provider"}</p>
        <p className="break-all">{data.policy.effective?.strategy === "weighted" ? "按权重选择首选" : data.policy.effective ? "按序选择首个可用候选" : "默认 Provider"}：{data.currentTargets.map(target => `${providerName(target.providerId)} · ${target.upstreamModel}${data.policy.effective?.strategy === "weighted" ? `（权重 ${data.policy.effective.targets.find(value => value.providerId === target.providerId)?.weight}）` : ""}`).join(data.policy.effective?.strategy === "weighted" ? "、" : " → ")}</p>
        <p className="text-xs text-text-secondary">{data.policy.effective?.allowFallbacks ? "允许明确拒绝后的后备；响应开始或执行不明后不切换。" : "跨 Provider 后备关闭。"}</p>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-text-tertiary"><span>{healthTime(data.meta.from)} — {healthTime(data.meta.to)} · 本地时间</span><span>数据更新于 {healthTime(data.meta.generatedAt)}</span></div>
      <section className="space-y-4" aria-label="模型可用性">
        <div><h3 className="font-display text-xl font-semibold">可用性</h3><p className="mt-2 text-xs leading-5 text-text-secondary">基于已开始上游调用的真实请求；统计范围包含历史策略版本。成功率按请求计算，取消与进行中单列，无样本时段留空。</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          ["请求成功率", healthPercent(data.summary.successRate), `${data.summary.succeeded} 成功 / ${data.summary.succeeded + data.summary.failed} 已完成`],
          ["后备恢复", `${data.summary.recovered} 次`, "首选失败后最终成功"],
          ["失败请求", `${data.summary.failed} 次`, "包含流中断和执行不明"],
          ["进行中 / 取消", `${data.summary.pending} / ${data.summary.cancelled}`, `${data.summary.requests} 次上游请求观测`],
        ].map(([label, value, detail]) => <div key={label} className="rounded-xl border border-border bg-bg-surface p-4"><p className="text-xs text-text-tertiary">{label}</p><p className="mt-3 font-mono text-2xl text-text-primary">{value}</p><p className="mt-2 text-xs text-text-secondary">{detail}</p></div>)}</div>
        <div className="rounded-xl border border-border bg-bg-surface p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">可用性时间线</h4><p className="text-xs text-text-secondary">绿色：成功 · 黄色：存在失败 · 红色：全部失败 · 灰色：无完成样本</p></div>
          <div className="mt-4 flex h-10 gap-px" aria-label="小时可用性时间线">{data.timeline.map(value => <button type="button" key={value.at} onClick={() => setSelectedHour(value.at)} aria-label={`${healthTime(value.at)}：${healthPercent(value.successRate)}，${value.succeeded}成功，${value.failed}失败，${value.cancelled}取消，${value.pending}进行中`} title={`${healthTime(value.at)} · ${healthPercent(value.successRate)}`} className={`min-w-0 flex-1 rounded-sm focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary ${value.successRate === null ? "bg-bg-secondary" : value.failed === 0 ? "bg-success" : value.succeeded === 0 ? "bg-danger" : "bg-accent-orange"}`} />)}</div>
          <div className="mt-2 flex justify-between text-xs text-text-tertiary"><span>{healthTime(data.meta.from)}</span><span>现在</span></div>
          {point ? <p className="mt-3 text-xs leading-5 text-text-secondary" role="status">{healthTime(point.at)} · 成功率 {healthPercent(point.successRate)} · {point.succeeded}成功 / {point.failed}失败 / {point.cancelled}取消 / {point.pending}进行中 · 执行耗时 P50 {healthDuration(point.latency.p50Ms)} · 首 Token P50 {healthDuration(point.firstToken.p50Ms)}</p> : null}
        </div>
        {!data.summary.requests ? <p role="status" className="text-sm text-text-secondary">此范围尚无上游请求观测；当前启用状态不代表持续在线。</p> : null}
        <RoutingHealthChart points={data.timeline} metric="successRate" title="小时请求成功率" />
      </section>
      <section className="space-y-4" aria-label="链路性能"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-xl font-semibold">链路性能</h3><label className="flex items-center gap-3 text-sm">性能指标<select className={control} value={metric} onChange={event => setMetric(event.target.value as typeof metric)}><option value="latency">Gateway 执行耗时</option><option value="firstToken">流式首 Token 时间</option></select></label></div>
        <p className="text-xs leading-5 text-text-secondary">仅统计成功请求。执行耗时包含后备尝试；首 Token 只使用已记录的成功流式样本。P50 为中位数，P95 表示 95% 样本不超过该值。</p>
        <div className="flex flex-wrap gap-5 text-sm"><span>P50：{healthDuration(data.summary[metric].p50Ms)}</span><span>P95：{healthDuration(data.summary[metric].p95Ms)}</span><span className="text-text-tertiary">{data.summary[metric].samples} 个样本</span></div>
        <RoutingHealthChart points={data.timeline} metric={metric} title={metric === "latency" ? "Gateway 执行耗时" : "流式首 Token 时间"} />
      </section>
      <section className="space-y-3" aria-label="Provider 链路健康"><h3 className="font-display text-xl font-semibold">Provider 链路健康</h3><p className="text-xs leading-5 text-text-secondary">按每次尝试记录成功与失败，保留首选失败证据；耗时归属最终成功 Provider，包含该请求的完整 Gateway 执行过程。未使用的候选显示无数据。</p>
        <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead><tr>{["Provider / 上游型号", "配置", "尝试成功率", "成功 / 失败", "进行中 / 取消", "成功请求耗时 P50 / P95", "最后观测"].map(label => <th key={label} className="border-b border-border px-3 py-3 text-xs text-text-tertiary">{label}</th>)}</tr></thead><tbody>{data.providers.map(provider => <tr key={`${provider.providerId}:${provider.upstreamModel}`}><td className="border-b border-border px-3 py-4"><p className="font-semibold">{provider.providerName}</p><p className="mt-1 break-all font-mono text-xs text-text-secondary">{provider.upstreamModel}</p><p className="mt-1 text-xs text-text-tertiary">{provider.current ? "当前候选" : "历史链路"}</p></td><td className="border-b border-border px-3 py-4">{provider.providerStatus === "active" ? "启用" : provider.providerStatus === "disabled" ? "停用" : "已删除"}</td><td className="border-b border-border px-3 py-4">{healthPercent(provider.successRate)}</td><td className="border-b border-border px-3 py-4 font-mono">{provider.succeeded} / {provider.failed}</td><td className="border-b border-border px-3 py-4 font-mono">{provider.pending} / {provider.cancelled}</td><td className="border-b border-border px-3 py-4 font-mono text-xs">{healthDuration(provider.latency.p50Ms)} / {healthDuration(provider.latency.p95Ms)}</td><td className="border-b border-border px-3 py-4 text-xs">{provider.lastObservedAt ? healthTime(provider.lastObservedAt) : "暂无观测"}</td></tr>)}</tbody></table></div>
        {data.meta.providerTotal > data.meta.providerPageSize ? <nav className="flex items-center gap-3 text-xs" aria-label="链路健康分页"><button type="button" disabled={page === 1 || health.isFetching} className={control} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页 · {data.meta.providerTotal} 条链路</span><button type="button" disabled={page * data.meta.providerPageSize >= data.meta.providerTotal || health.isFetching} className={control} onClick={() => setPage(page + 1)}>下一页</button></nav> : null}
      </section>
    </> : null}
  </section>;
}
