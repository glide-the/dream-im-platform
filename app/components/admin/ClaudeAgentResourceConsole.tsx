// [Input] Dedicated Claude Agent resource API, system.write access, and a cancellable React Query signal.
// [Output] Desired/effective policy controls and content-free process/cgroup monitoring.
// [Pos] Admin system-governance console; it cannot restart Dream, kill processes, or disable admission.

"use client";

import { useCan } from "@refinedev/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

export const CLAUDE_AGENT_REFRESH_INTERVAL_MS = 10_000;

export type PolicyValues = {
  maxConcurrentRuns: number;
  runMemoryBudgetMib: number;
  memoryReserveMib: number;
  retryAfterSeconds: number;
};

type Bound = { min: number; max: number };
type Diagnostics = {
  backend_status: "ok";
  scope: { active_runs: "process"; counters: "process_lifetime"; reset_on_restart: boolean };
  config: {
    defaults: Record<string, number>;
    environment: Record<string, number | null>;
    effective: Record<string, number>;
    effective_version: string;
    loaded_at: string;
    restart_required: boolean;
  };
  turns: { started_total: number; completed_total: number; failed_total: number; cancelled_total: number };
  admission: {
    active_runs: number;
    max_concurrent_runs: number;
    granted_total: number;
    capacity_denials_total: number;
    memory_pressure_denials_total: number;
    last_denial_type: "capacity" | "memory_pressure" | null;
    last_denial_at: string | null;
    can_start_new_agent: boolean | null;
  };
  claude_processes: { available: boolean; count: number | null; total_rss_bytes: number | null };
  memory: Record<string, number | null> & { events: Record<string, number | null> };
  sample: { status: string; sampled_at: string | null; age_seconds: number | null; stale: boolean; error_code: string | null };
};

export type ClaudeAgentResourceResponse = {
  policy: { schemaVersion: number; bounds: Record<keyof PolicyValues, Bound>; defaults: PolicyValues };
  desired: (PolicyValues & { schemaVersion: number; revision: number; updatedAt: string }) | null;
  runtime: Diagnostics | null;
  runtimeError: { code: string; message: string } | null;
  application: { status: "unknown" | "not_configured" | "applied" | "pending"; applied: boolean | null; restartRequired: boolean | null };
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Claude Agent 资源数据不可用");
  return body.data;
}

export async function fetchClaudeAgentResources(signal?: AbortSignal) {
  return await parseResponse<ClaudeAgentResourceResponse>(
    await fetch("/api/admin/claude-agent-resources", { signal, headers: { accept: "application/json" } }),
  );
}

function value(value: unknown) {
  return value === null || value === undefined ? "不可用" : String(value);
}

function bytes(valueInBytes: number | null | undefined) {
  if (valueInBytes === null || valueInBytes === undefined) return "不可用";
  return `${(valueInBytes / 1024 / 1024).toFixed(1)} MiB`;
}

export const CLAUDE_AGENT_ENV_FIELDS: Array<{
  key: keyof PolicyValues;
  label: string;
  env: string;
  dreamEnv: string;
  autoDlEnv: string;
}> = [
  { key: "maxConcurrentRuns", label: "最大并发 Agent turn", env: "max_concurrent_runs", dreamEnv: "INK_AGENT_MAX_CONCURRENT_RUNS", autoDlEnv: "AUTODL_AGENT_MAX_CONCURRENT_RUNS" },
  { key: "runMemoryBudgetMib", label: "单次 Agent 内存预算（MiB）", env: "run_memory_budget_mib", dreamEnv: "INK_AGENT_RUN_MEMORY_BUDGET_MIB", autoDlEnv: "AUTODL_AGENT_RUN_MEMORY_BUDGET_MIB" },
  { key: "memoryReserveMib", label: "系统保留内存（MiB）", env: "memory_reserve_mib", dreamEnv: "INK_AGENT_MEMORY_RESERVE_MIB", autoDlEnv: "AUTODL_AGENT_MEMORY_RESERVE_MIB" },
  { key: "retryAfterSeconds", label: "重试等待（秒）", env: "retry_after_seconds", dreamEnv: "INK_AGENT_SWEEP_INTERVAL_S", autoDlEnv: "AUTODL_AGENT_SWEEP_INTERVAL_S" },
];

export function buildDreamAutoDlPolicyProjection(desired: PolicyValues | null | undefined) {
  if (!desired) return null;
  return CLAUDE_AGENT_ENV_FIELDS
    .map(({ key, autoDlEnv }) => `${autoDlEnv}=${desired[key]}`)
    .join("\n");
}

export function formatCanStartNewAgent(allowed: boolean | null | undefined, stale: boolean) {
  if (stale || allowed === null || allowed === undefined) return "不可用";
  return allowed ? "允许" : "拒绝";
}

export default function ClaudeAgentResourceConsole() {
  const queryClient = useQueryClient();
  const writeAccess = useCan({ resource: "claude-agent-resources", action: "edit" });
  const query = useQuery({
    queryKey: ["claude-agent-resources"],
    queryFn: ({ signal }) => fetchClaudeAgentResources(signal),
    refetchInterval: CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  });
  const data = query.data;
  const [form, setForm] = useState<PolicyValues | null>(null);
  const effectivePolicy = data?.runtime?.config.effective;
  const displayedForm = form ?? data?.desired ?? (effectivePolicy ? {
      maxConcurrentRuns: effectivePolicy.max_concurrent_runs,
      runMemoryBudgetMib: effectivePolicy.run_memory_budget_mib,
      memoryReserveMib: effectivePolicy.memory_reserve_mib,
      retryAfterSeconds: effectivePolicy.retry_after_seconds,
    } : data?.policy.defaults ?? null);

  const mutation = useMutation({
    mutationFn: async (input: PolicyValues) => parseResponse(
      await fetch("/api/admin/claude-agent-resources", {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["claude-agent-resources"] }); },
  });

  const runtime = data?.runtime;
  const deploymentProjection = buildDreamAutoDlPolicyProjection(data?.desired);
  const memoryRows = useMemo(() => runtime ? [
    ["宿主机可用内存", bytes(runtime.memory.host_available_bytes)],
    ["cgroup memory.current", bytes(runtime.memory.cgroup_current_bytes)],
    ["cgroup memory.max", bytes(runtime.memory.cgroup_max_bytes)],
    ["原始余量", bytes(runtime.memory.cgroup_raw_headroom_bytes)],
    ["inactive_file", bytes(runtime.memory.inactive_file_bytes)],
    ["slab_reclaimable", bytes(runtime.memory.slab_reclaimable_bytes)],
    ["保守有效余量", bytes(runtime.memory.cgroup_effective_headroom_bytes)],
    ["本次准入要求", bytes(runtime.memory.required_headroom_bytes)],
  ] : [], [runtime]);

  if (query.error && !data) {
    return <div className="bg-danger-light p-5 text-sm text-danger" role="alert"><p className="font-semibold">资源控制台不可用</p><p className="mt-1">{query.error.message}</p><button className="mt-3 min-h-10 underline" onClick={() => query.refetch()} type="button">重新加载</button></div>;
  }

  return (
    <div className="space-y-6">
      <section className="border border-border bg-surface px-5 py-4" aria-label="Dream 诊断状态">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Live diagnostic channel</p><p className="mt-2 font-display text-xl font-semibold">{runtime ? "Dream 已连接" : "Dream 不可达"}</p></div>
          <div className={`px-3 py-1 font-mono text-xs ${runtime?.sample.stale ? "bg-accent-orange-light" : runtime ? "bg-success-light" : "bg-danger-light text-danger"}`}>{runtime?.sample.stale ? "STALE" : runtime ? "LIVE" : "UNAVAILABLE"}</div>
        </div>
        <p className="mt-3 text-sm text-text-secondary">{data?.runtimeError?.message ?? `采样 ${runtime?.sample.sampled_at ? new Date(runtime.sample.sampled_at).toLocaleString() : "不可用"} · 每 10 秒刷新`}</p>
        <p className="mt-1 text-xs text-text-tertiary">活跃数与累计计数均为单 Dream 进程指标；进程重启后累计计数清零。这里不展示数据库历史趋势。</p>
      </section>
      {query.error && data ? <div className="bg-danger-light px-5 py-3 text-sm text-danger" role="alert">刷新失败，继续显示上一份已缓存快照：{query.error.message}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="准入概览">
        {[
          ["当前活跃 / 最大并发", runtime ? `${runtime.admission.active_runs} / ${runtime.admission.max_concurrent_runs}` : "不可用"],
          ["当前允许启动", formatCanStartNewAgent(runtime?.admission.can_start_new_agent, runtime?.sample.stale ?? true)],
          ["Capacity 拒绝", value(runtime?.admission.capacity_denials_total)],
          ["Memory 拒绝", value(runtime?.admission.memory_pressure_denials_total)],
        ].map(([label, metric]) => <div key={label} className="border-l-2 border-text-primary bg-surface-muted px-5 py-4"><p className="text-xs text-text-secondary">{label}</p><p className="mt-3 font-mono text-2xl font-semibold">{metric}</p></div>)}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-semibold">期望配置与当前生效值</h2>
          <p className="mt-2 text-sm text-text-secondary">保存只写入 Admin 期望配置，不会立即改变 Dream。差异需要安全部署投影和受控重启后生效。</p>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-border text-xs text-text-tertiary"><th className="py-3">阈值</th><th>默认</th><th>环境变量</th><th>Admin 期望</th><th>Dream 生效</th></tr></thead><tbody>
            {CLAUDE_AGENT_ENV_FIELDS.map(({ key, label, env, dreamEnv }) => {
              const bound = data?.policy.bounds[key];
              const desired = displayedForm?.[key];
              return <tr className="border-b border-border/60" key={key}><th className="py-4 pr-4 font-medium"><span>{label}</span><code className="mt-1 block text-[11px] font-normal text-text-tertiary">{dreamEnv}</code></th><td className="font-mono">{value(data?.policy.defaults[key])}</td><td className="font-mono">{value(runtime?.config.environment[env])}</td><td className="pr-4"><input aria-label={label} className="w-28 border border-border bg-background px-3 py-2 font-mono" disabled={!writeAccess.data?.can || mutation.isPending || desired === undefined} min={bound?.min} max={bound?.max} type="number" value={desired ?? ""} onChange={(event) => displayedForm && setForm({ ...displayedForm, [key]: Number(event.target.value) })} /></td><td className="font-mono">{value(runtime?.config.effective[env])}</td></tr>;
            })}
          </tbody></table></div>
          <div className="mt-5 grid gap-2 border-t border-border pt-4 text-sm text-text-secondary sm:grid-cols-2"><p>应用状态：<strong className="text-text-primary">{data?.application.status ?? "unknown"}</strong></p><p>配置 revision：<span className="font-mono text-text-primary">{data?.desired?.revision ?? "未配置"}</span></p><p>期望配置更新时间：<span className="text-text-primary">{data?.desired?.updatedAt ? new Date(data.desired.updatedAt).toLocaleString() : "不可用"}</span></p><p>Dream 加载时间：<span className="text-text-primary">{runtime?.config.loaded_at ? new Date(runtime.config.loaded_at).toLocaleString() : "不可用"}</span></p><p>Dream effective version：<span className="font-mono text-text-primary" title={runtime?.config.effective_version}>{runtime?.config.effective_version ? `${runtime.config.effective_version.slice(0, 20)}${runtime.config.effective_version.length > 20 ? "…" : ""}` : "不可用"}</span></p><p>{data?.application.restartRequired ? "需要部署投影并受控重启" : "无需重启或状态未知"}</p></div>
          <div className="mt-5 flex justify-end">{writeAccess.data?.can ? <button type="button" disabled={!displayedForm || mutation.isPending} onClick={() => { if (displayedForm && window.confirm("仅保存期望配置；不会重启 Dream 或立即改变 Agent 准入。继续吗？")) mutation.mutate(displayedForm); }} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-background disabled:opacity-50">{mutation.isPending ? "保存中…" : "保存期望配置"}</button> : null}</div>
          {mutation.error ? <p className="mt-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
          <div className="mt-6 bg-surface-muted p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Operator handoff · read only</p><p className="mt-2 text-sm leading-6 text-text-secondary">由 operator 将以下 Admin desired 值复制到 Dream AutoDL 的 <code>AUTODL_AGENT_*</code> 平台配置，再走既有 deploy 流程并执行受控重启。控制台不会执行部署或重启。</p>{deploymentProjection ? <pre className="mt-3 overflow-x-auto border-l-2 border-text-primary bg-background p-3 font-mono text-xs leading-6" aria-label="Dream AutoDL 部署投影">{deploymentProjection}</pre> : <p className="mt-3 text-sm text-text-tertiary">尚未保存 desired 配置，暂无部署投影。</p>}</div>
        </section>

        <section className="border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-semibold">Turn 生命周期</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">{[["开始", runtime?.turns.started_total],["完成", runtime?.turns.completed_total],["失败", runtime?.turns.failed_total],["取消", runtime?.turns.cancelled_total],["Claude 子进程", runtime?.claude_processes.count],["子进程总 RSS", bytes(runtime?.claude_processes.total_rss_bytes)]].map(([label, metric]) => <div key={String(label)}><dt className="text-xs text-text-tertiary">{label}</dt><dd className="mt-1 font-mono text-lg">{value(metric)}</dd></div>)}</dl>
          <div className="mt-5 border-t border-border pt-4 text-sm text-text-secondary"><p>最近拒绝：{value(runtime?.admission.last_denial_type)}</p><p className="mt-1">时间：{runtime?.admission.last_denial_at ? new Date(runtime.admission.last_denial_at).toLocaleString() : "不可用"}</p></div>
        </section>
      </div>

      <section className="border border-border bg-surface p-5"><h2 className="font-display text-xl font-semibold">Linux / cgroup v2 内存</h2><div className="mt-5 grid gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">{memoryRows.map(([label, metric]) => <div key={label}><p className="text-xs text-text-tertiary">{label}</p><p className="mt-1 font-mono text-lg">{metric}</p></div>)}</div><div className="mt-5 border-t border-border pt-4"><p className="text-xs text-text-tertiary">memory.events（累计）</p><p className="mt-2 font-mono text-sm">{runtime ? Object.entries(runtime.memory.events).map(([key, metric]) => `${key}=${value(metric)}`).join("  ·  ") : "不可用"}</p></div>{runtime?.sample.error_code ? <p className="mt-4 text-sm text-danger">采样降级：{runtime.sample.error_code}</p> : null}</section>
    </div>
  );
}
