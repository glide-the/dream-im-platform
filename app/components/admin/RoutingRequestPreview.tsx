"use client";
// [Input] Current effective revision, edited status/targets and safe Provider labels.
// [Output] Distinct current/expected rules and an accessible responsive business sequence diagram.
// [Pos] Read-only routing explanation; no simulation, random choice or upstream call.
import { useId } from "react";
import type { RoutingConfig } from "@/lib/models/routing-policy";
import { routingPreview, routingSelectionSummary, type DefaultRoutingTarget } from "./routingPreview";

function SequenceDiagram({ preview, modelCode, name }: {
  preview: ReturnType<typeof routingPreview>; modelCode: string; name: (id: string) => string;
}) {
  const marker = useId().replaceAll(":", "");
  const fallback = preview.allowFallbacks && preview.targets.length > 1;
  const primary = preview.strategy === "weighted" ? "按可用候选权重选首选" : `${name(preview.targets[0].providerId)} 优先，取首个可用项`;
  const events = [
    { from: 0, to: 1, label: `请求 model=${modelCode}` },
    { from: 1, to: 3, label: "鉴权、权限、策略与价格快照" },
    { from: 1, to: 3, label: "权益与额度校验；预授权一次" },
    { from: 1, to: 2, label: primary },
    ...(fallback ? [
      { from: 2, to: 1, label: "可后备的明确拒绝（条件分支）", conditional: true },
      { from: 1, to: 2, label: "按剩余配置顺序尝试下一项", conditional: true },
    ] : []),
    { from: 2, to: 1, label: "实际执行 Provider 接受响应" },
    { from: 1, to: 0, label: "流式：边接收边转发，开始后不切换", conditional: true },
    { from: 2, to: 1, label: "JSON 用量 / 流终止后的已确认用量" },
    { from: 1, to: 3, label: "记录实际 Provider、尝试；原价格结算" },
    { from: 1, to: 0, label: "非流式：结算后返回结果或错误", conditional: true },
  ];
  const positions = [75, 320, 565, 810];
  const height = 115 + events.length * 62;
  return <figure className="min-w-0" aria-label="预期请求业务时序图">
    <h3 className="mb-3 font-display text-lg font-semibold">预期请求链路</h3>
    <div className="max-w-full overflow-x-auto rounded-xl border border-border bg-bg-surface">
      <svg role="img" aria-label="用户请求的路由与计费时序" viewBox={`0 0 885 ${height}`} className="block w-full min-w-[760px] text-text-secondary">
        <title>用户请求的路由与计费时序</title>
        <desc>先鉴权并固定策略和价格，再预授权与选择上游；后备为条件分支，流式开始后不切换，按实际执行与已确认用量结算。</desc>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
        {["用户", "Gateway", "上游 Provider", "平台记录与计费"].map((label, index) => <g key={label}>
          <rect x={positions[index] - 70} y={16} width={140} height={42} rx={10} fill="var(--color-bg-secondary, transparent)" stroke="currentColor" opacity={0.7} />
          <text x={positions[index]} y={43} textAnchor="middle" fill="currentColor" fontSize={14}>{label}</text>
          <line x1={positions[index]} x2={positions[index]} y1={58} y2={height - 18} stroke="currentColor" strokeDasharray="4 5" opacity={0.25} />
        </g>)}
        {events.map((event, index) => {
          const y = 105 + index * 62;
          const characters = [...event.label];
          const lines = characters.length > 28 ? [characters.slice(0, 28).join(""), characters.slice(28, 54).join("") + (characters.length > 54 ? "…" : "")] : [event.label];
          return <g key={index}>
            <text x={(positions[event.from] + positions[event.to]) / 2} y={y - (lines.length > 1 ? 27 : 12)} textAnchor="middle" fill="currentColor" fontSize={12}><title>{event.label}</title>{lines.map((line, lineIndex) => <tspan key={lineIndex} x={(positions[event.from] + positions[event.to]) / 2} dy={lineIndex ? 15 : 0}>{line}</tspan>)}</text>
            <line x1={positions[event.from]} x2={positions[event.to]} y1={y} y2={y} stroke="currentColor" strokeDasharray={event.conditional ? "6 4" : undefined} markerEnd={`url(#${marker})`} />
          </g>;
        })}
      </svg>
    </div>
    <figcaption className="mt-2 text-xs leading-5 text-text-tertiary">虚线表示条件分支。图中为成功链路；不可后备的错误直接结束，按已确认用量处理，执行情况不明时留待核对。</figcaption>
  </figure>;
}

export default function RoutingRequestPreview({ desired, status, effective, revision, dirty, defaultTarget, modelCode, providerName }: {
  desired: RoutingConfig; status: "draft" | "active" | "disabled"; effective?: RoutingConfig | null;
  revision: number; dirty: boolean; defaultTarget?: DefaultRoutingTarget; modelCode: string;
  providerName: (id: string) => string;
}) {
  const preview = routingPreview(status === "active" ? desired : null, defaultTarget);
  const current = routingPreview(effective ?? null, defaultTarget);
  const total = preview.targets.reduce((sum, target) => sum + target.weight, 0);
  const fallback = preview.allowFallbacks && preview.targets.length > 1;
  return <section className="min-w-0 space-y-5 border-t border-border pt-5" aria-label="请求规则与链路预览">
    <div className="space-y-2 break-all text-sm">
      <p>默认 Provider：{defaultTarget ? `${providerName(defaultTarget.providerId)} · ${defaultTarget.upstreamModel}` : "先选择模型"}</p>
      <p>当前生效规则{revision ? `（版本 ${revision}）` : ""}：{routingSelectionSummary(current, providerName)}</p>
      <p className="text-xs text-text-tertiary">保存成功后影响新请求；已开始的请求保持原策略与价格快照。</p>
    </div>
    <div role="region" aria-label="保存后的预期请求规则" className="rounded-xl border border-border bg-bg-secondary p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg font-semibold">保存后的预期请求规则</h3><span className="text-xs text-text-secondary">{dirty ? "未保存的编辑预览" : "与当前保存配置一致"}</span></div>
      {!preview.valid ? <p className="mt-3 text-sm text-text-secondary">{modelCode ? routingSelectionSummary(preview, providerName) : "选择模型后显示请求规则与链路。"}</p> : <>
        <p className="mt-3 text-sm">{status !== "active" ? "草稿或停用不参与路由，新请求使用默认 Provider。" : routingSelectionSummary(preview, providerName)}</p>
        <ol className="mt-3 space-y-2 text-sm">
          {preview.targets.map((target, index) => <li key={target.providerId} className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-mono text-text-tertiary">{index + 1}.</span><span className="min-w-0 max-w-full break-all">{providerName(target.providerId)} · {target.upstreamModel}</span>{preview.strategy === "weighted" ? <span className="text-xs text-text-secondary">权重 {target.weight} · 首选占比 {(target.weight / total * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%</span> : null}</li>)}
        </ol>
        <p className="mt-3 text-xs leading-5 text-text-secondary">{preview.strategy === "weighted" ? "比例按全部配置候选计算；每次请求按当时可用候选重算。权重只选择首选，后备保留剩余配置顺序。" : "先筛除停用、凭据或型号不可用的候选，再选择首个可用项；筛选时跳过不可用项不属于故障转移。"}</p>
        <p className="mt-2 text-xs leading-5 text-text-secondary">{fallback ? "允许后备：响应开始前明确返回 429、502、503 或 504，且没有 usage/response 执行证据时，依次尝试剩余候选。" : "后备关闭：首选上游失败后直接结束，不再调用其他 Provider。"}</p>
      </>}
    </div>
    {preview.valid ? <>
      <ul className="list-inside list-disc space-y-2 text-xs leading-5 text-text-secondary">
        <li>所有候选均不可用时返回错误，不调用上游；请求仍须满足 Gateway Key、模型权限、订阅权益与额度。</li>
        <li>超时、网络中断、执行状态不明或响应已开始后不切换 Provider；每个路由候选至多尝试一次。</li>
        <li>一次请求只预授权一次；记录实际 Provider、尝试过程与已确认用量，沿用原模型价格快照结算，执行不明留待核对。</li>
      </ul>
      <SequenceDiagram preview={preview} modelCode={modelCode} name={providerName} />
    </> : null}
  </section>;
}
