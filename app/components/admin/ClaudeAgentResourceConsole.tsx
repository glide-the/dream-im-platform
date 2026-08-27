// [Input] PostgreSQL-projected Claude Agent resource API, system.write access, and a cancellable React Query signal.
// [Output] Validated desired/effective controls with immediate pending feedback plus process/cgroup monitoring.
// [Pos] Admin system-governance console; it cannot call Dream, restart processes, or deploy configuration.
// [Sync] 2026-08-27: block invalid drafts before PATCH and explain Dream's periodic PostgreSQL application loop.

"use client";

import { useCan } from "@refinedev/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

export const CLAUDE_AGENT_REFRESH_INTERVAL_MS = 10_000;
export const CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS = "inline-flex min-h-11 items-center justify-center bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:cursor-not-allowed disabled:opacity-45";

export type PolicyValues = {
  maxConcurrentRuns: number;
  runMemoryBudgetMib: number;
  memoryReserveMib: number;
  retryAfterSeconds: number;
};

type Bound = { min: number; max: number };
export type PolicyBounds = Record<keyof PolicyValues, Bound>;
type AdmissionValues = {
  max_concurrent_runs: number;
  run_memory_budget_mib: number;
  memory_reserve_mib: number;
  retry_after_seconds: number;
  required_headroom_bytes: number;
};
type Runtime = {
  instance_id: string;
  process_started_at: string;
  heartbeat_at: string;
  heartbeat_age_seconds: number;
  sampled_at: string | null;
  sample_age_seconds: number | null;
  freshness: "fresh" | "stale" | "offline";
  backend_status: "ok";
  scope: { active_runs: "process"; counters: "process_lifetime"; reset_on_restart: true };
  config: {
    defaults: AdmissionValues;
    effective: AdmissionValues;
    effective_version: string;
    loaded_at: string;
    policy_status: "applied" | "not_configured" | "invalid" | "unavailable";
    policy_revision: number | null;
    policy_updated_at: string | null;
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
  memory: {
    host_available_bytes: number | null;
    cgroup_current_bytes: number | null;
    cgroup_max_bytes: number | null;
    cgroup_raw_headroom_bytes: number | null;
    inactive_file_bytes: number | null;
    slab_reclaimable_bytes: number | null;
    cgroup_reclaimable_bytes: number | null;
    cgroup_effective_headroom_bytes: number | null;
    required_headroom_bytes: number;
    events: { low: number | null; high: number | null; max: number | null; oom: number | null; oom_kill: number | null };
  };
  sample: {
    status: "starting" | "ok" | "unavailable" | "timeout" | "error";
    sampled_at: string | null;
    stale: boolean;
    error_code: string | null;
  };
  pipeline: { queue_dropped_total: number; write_errors_total: number; last_write_error_at: string | null };
};

type DesiredProjection = {
  status: "valid" | "invalid" | "not_configured";
  values: (PolicyValues & { schemaVersion: number; revision: number }) | null;
  revision: number | null;
  updatedAt: string | null;
};

export type ClaudeAgentResourceResponse = {
  policy: {
    schemaVersion: number;
    bounds: PolicyBounds;
    defaults: PolicyValues;
    freshness: { freshSeconds: number; offlineSeconds: number };
  };
  desired: DesiredProjection;
  runtime: Runtime | null;
  runtimeError: { code: string; message: string } | null;
  application: {
    status: "applied" | "pending" | "invalid" | "unavailable" | "not_configured";
    applied: boolean | null;
  };
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok || !body.data) {
    throw new Error(
      body.error?.code === "CLAUDE_AGENT_POLICY_INVALID"
        ? "配置未保存：请确认四项阈值都是页面允许范围内的整数。"
        : body.error?.message ?? "Claude Agent 资源数据不可用",
    );
  }
  return body.data;
}

export async function fetchClaudeAgentResources(signal?: AbortSignal) {
  return await parseResponse<ClaudeAgentResourceResponse>(
    await fetch("/api/admin/claude-agent-resources", {
      signal,
      headers: { accept: "application/json" },
    }),
  );
}

function value(metric: unknown) {
  return metric === null || metric === undefined ? "未知" : String(metric);
}

function timestamp(metric: string | null | undefined) {
  return metric ? new Date(metric).toLocaleString() : "未知";
}

function seconds(metric: number | null | undefined) {
  return metric === null || metric === undefined ? "未知" : `${metric.toFixed(1)} 秒`;
}

function bytes(valueInBytes: number | null | undefined) {
  if (valueInBytes === null || valueInBytes === undefined) return "未知";
  return `${(valueInBytes / 1024 / 1024).toFixed(1)} MiB`;
}

export const CLAUDE_AGENT_POLICY_FIELDS: Array<{
  key: keyof PolicyValues;
  effectiveKey: keyof Pick<AdmissionValues, "max_concurrent_runs" | "run_memory_budget_mib" | "memory_reserve_mib" | "retry_after_seconds">;
  label: string;
}> = [
  { key: "maxConcurrentRuns", effectiveKey: "max_concurrent_runs", label: "最大并发 Agent turn" },
  { key: "runMemoryBudgetMib", effectiveKey: "run_memory_budget_mib", label: "单次 Agent 内存预算（MiB）" },
  { key: "memoryReserveMib", effectiveKey: "memory_reserve_mib", label: "系统保留内存（MiB）" },
  { key: "retryAfterSeconds", effectiveKey: "retry_after_seconds", label: "重试等待（秒）" },
];

export function formatCanStartNewAgent(allowed: boolean | null | undefined, stale: boolean) {
  if (stale || allowed === null || allowed === undefined) return "未知";
  return allowed ? "允许" : "拒绝";
}

export function policyMutationPayload(
  values: PolicyValues,
  expectedRevision: number | null,
) {
  return { ...values, expectedRevision };
}

export function policySaveButtonState(
  hasDraft: boolean,
  pending: boolean,
  revisionConflict: boolean,
  invalid: boolean,
) {
  return {
    disabled: !hasDraft || pending || revisionConflict || invalid,
    label: pending
      ? "保存中…"
      : invalid
        ? "请检查输入范围"
        : hasDraft
          ? "保存期望配置"
          : "修改后可保存",
  };
}

export function policyValidationErrors(
  values: PolicyValues | null,
  bounds: PolicyBounds | undefined,
) {
  const errors: Partial<Record<keyof PolicyValues, string>> = {};
  if (!values || !bounds) return errors;
  for (const key of Object.keys(bounds) as Array<keyof PolicyValues>) {
    const metric = values[key];
    const bound = bounds[key];
    if (!Number.isFinite(metric) || !Number.isInteger(metric) || metric < bound.min || metric > bound.max) {
      errors[key] = `请输入 ${bound.min}–${bound.max} 之间的整数`;
    }
  }
  return errors;
}

export function projectSavedDesired(
  current: ClaudeAgentResourceResponse,
  desired: DesiredProjection,
): ClaudeAgentResourceResponse {
  return {
    ...current,
    desired,
    application: { status: "pending", applied: false },
  };
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
  const [editBaseRevision, setEditBaseRevision] = useState<number | null | undefined>(undefined);
  const effectivePolicy = data?.runtime?.config.effective;
  const displayedForm = form ?? data?.desired.values ?? (effectivePolicy
    ? {
        maxConcurrentRuns: effectivePolicy.max_concurrent_runs,
        runMemoryBudgetMib: effectivePolicy.run_memory_budget_mib,
        memoryReserveMib: effectivePolicy.memory_reserve_mib,
        retryAfterSeconds: effectivePolicy.retry_after_seconds,
      }
    : data?.policy.defaults ?? null);

  const mutation = useMutation({
    mutationFn: async (input: { values: PolicyValues; expectedRevision: number | null }) =>
      await parseResponse<{ desired: DesiredProjection }>(
        await fetch("/api/admin/claude-agent-resources", {
          method: "PATCH",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(policyMutationPayload(input.values, input.expectedRevision)),
        }),
      ),
    onSuccess: async ({ desired }) => {
      queryClient.setQueryData<ClaudeAgentResourceResponse>(
        ["claude-agent-resources"],
        (current) => current ? projectSavedDesired(current, desired) : current,
      );
      setForm(null);
      setEditBaseRevision(undefined);
      await queryClient.invalidateQueries({ queryKey: ["claude-agent-resources"] });
    },
  });

  const runtime = data?.runtime;
  const memoryRows = useMemo(
    () => runtime
      ? [
          ["宿主机可用内存", bytes(runtime.memory.host_available_bytes)],
          ["cgroup memory.current", bytes(runtime.memory.cgroup_current_bytes)],
          ["cgroup memory.max", bytes(runtime.memory.cgroup_max_bytes)],
          ["原始余量", bytes(runtime.memory.cgroup_raw_headroom_bytes)],
          ["inactive_file", bytes(runtime.memory.inactive_file_bytes)],
          ["slab_reclaimable", bytes(runtime.memory.slab_reclaimable_bytes)],
          ["可回收内存", bytes(runtime.memory.cgroup_reclaimable_bytes)],
          ["保守有效余量", bytes(runtime.memory.cgroup_effective_headroom_bytes)],
          ["本次准入要求", bytes(runtime.memory.required_headroom_bytes)],
        ]
      : [],
    [runtime],
  );

  if (query.error && !data) {
    return (
      <div className="bg-danger-light p-5 text-sm text-danger" role="alert">
        <p className="font-semibold">资源控制台不可用</p>
        <p className="mt-1">{query.error.message}</p>
        <button className="mt-3 min-h-10 underline" onClick={() => query.refetch()} type="button">重新加载</button>
      </div>
    );
  }

  const health = runtime?.freshness ?? "unavailable";
  const healthClass = health === "fresh"
    ? "bg-success-light"
    : health === "stale"
      ? "bg-accent-orange-light"
      : "bg-danger-light text-danger";
  const currentRevision = data?.desired.revision ?? null;
  const revisionChangedWhileEditing = form !== null
    && editBaseRevision !== undefined
    && editBaseRevision !== currentRevision;
  const validationErrors = policyValidationErrors(form, data?.policy.bounds);
  const draftInvalid = Object.keys(validationErrors).length > 0;
  const saveButton = policySaveButtonState(
    form !== null,
    mutation.isPending,
    revisionChangedWhileEditing,
    draftInvalid,
  );

  return (
    <div className="space-y-6">
      <section className="border border-border bg-surface px-5 py-4" aria-label="Dream PostgreSQL 观测状态">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-text-tertiary">PostgreSQL observer snapshot</p>
            <p className="mt-2 font-display text-xl font-semibold">Dream {health === "fresh" ? "在线" : health === "stale" ? "心跳陈旧" : health === "offline" ? "离线" : "不可用"}</p>
          </div>
          <div className={`px-3 py-1 font-mono text-xs ${healthClass}`}>{health.toUpperCase()}</div>
        </div>
        <div className="mt-3 grid gap-1 text-sm text-text-secondary md:grid-cols-2">
          <p>实例 epoch：<span className="font-mono text-text-primary" title={runtime?.instance_id}>{runtime?.instance_id ? runtime.instance_id.slice(0, 16) : "未知"}</span></p>
          <p>进程启动：<span className="text-text-primary">{timestamp(runtime?.process_started_at)}</span></p>
          <p>心跳：<span className="text-text-primary">{timestamp(runtime?.heartbeat_at)}</span> · {seconds(runtime?.heartbeat_age_seconds)}</p>
          <p>采样：<span className="text-text-primary">{timestamp(runtime?.sampled_at)}</span> · {seconds(runtime?.sample_age_seconds)}</p>
        </div>
        <p className="mt-3 text-xs text-text-tertiary">active 与累计值均为单 Dream 进程生命周期指标，进程重启后清零。Admin 每 10 秒读取 PostgreSQL，不直连 Dream。</p>
        {data?.runtimeError ? <p className="mt-2 text-sm text-danger">{data.runtimeError.message}</p> : null}
      </section>

      {query.error && data ? <div className="bg-danger-light px-5 py-3 text-sm text-danger" role="alert">刷新失败，继续显示上一份缓存结果：{query.error.message}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="准入概览">
        {[
          ["当前活跃 / 最大并发", runtime ? `${runtime.admission.active_runs} / ${runtime.admission.max_concurrent_runs}` : "未知"],
          ["当前允许启动", formatCanStartNewAgent(runtime?.admission.can_start_new_agent, runtime?.sample.stale ?? true)],
          ["累计准入 grant", value(runtime?.admission.granted_total)],
          ["Capacity / Memory 拒绝", runtime ? `${runtime.admission.capacity_denials_total} / ${runtime.admission.memory_pressure_denials_total}` : "未知"],
        ].map(([label, metric]) => (
          <div key={label} className="border-l-2 border-text-primary bg-surface-muted px-5 py-4">
            <p className="text-xs text-text-secondary">{label}</p>
            <p className="mt-3 font-mono text-2xl font-semibold">{metric}</p>
          </div>
        ))}
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="min-w-0 overflow-hidden border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-semibold">默认、期望与生效策略</h2>
          <p className="mt-2 text-sm text-text-secondary">保存只更新 PostgreSQL desired；Dream 定时读取并动态应用，无需重启。控制台不提供部署或进程控制。</p>
          <div className="mt-5 max-w-full overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead><tr className="border-b border-border text-xs text-text-tertiary"><th className="py-3">阈值</th><th>默认</th><th>Admin desired</th><th>Dream effective</th></tr></thead>
              <tbody>
                {CLAUDE_AGENT_POLICY_FIELDS.map(({ key, effectiveKey, label }) => {
                  const bound = data?.policy.bounds[key];
                  const desired = displayedForm?.[key];
                  const validationError = validationErrors[key];
                  const helpId = `claude-agent-policy-${key}-help`;
                  return (
                    <tr className="border-b border-border/60" key={key}>
                      <th className="py-4 pr-4 font-medium">{label}</th>
                      <td className="font-mono">{value(data?.policy.defaults[key])}</td>
                      <td className="pr-4">
                        <input
                          aria-describedby={helpId}
                          aria-invalid={Boolean(validationError)}
                          aria-label={label}
                          className={`w-32 border bg-bg-primary px-3 py-2 font-mono text-text-primary disabled:opacity-60 ${validationError ? "border-danger" : "border-border"}`}
                          disabled={!writeAccess.data?.can || mutation.isPending || desired === undefined}
                          max={bound?.max}
                          min={bound?.min}
                          required
                          step={1}
                          type="number"
                          value={desired ?? ""}
                          onChange={(event) => {
                            if (!displayedForm) return;
                            if (form === null) {
                              setEditBaseRevision(currentRevision);
                              mutation.reset();
                            }
                            setForm({ ...displayedForm, [key]: Number(event.currentTarget.value) });
                          }}
                        />
                        <p className={`mt-1 text-[11px] ${validationError ? "text-danger" : "text-text-tertiary"}`} id={helpId}>
                          {validationError ?? (bound ? `${bound.min}–${bound.max}，仅限整数` : "仅限整数")}
                        </p>
                      </td>
                      <td className="font-mono">{value(runtime?.config.effective[effectiveKey])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-2 border-t border-border pt-4 text-sm text-text-secondary sm:grid-cols-2">
            <p>应用状态：<strong className="text-text-primary">{data?.application.status ?? "unavailable"}</strong></p>
            <p>desired 状态：<span className="font-mono text-text-primary">{data?.desired.status ?? "未知"}</span></p>
            <p>desired revision：<span className="font-mono text-text-primary">{value(data?.desired.revision)}</span></p>
            <p>effective revision：<span className="font-mono text-text-primary">{value(runtime?.config.policy_revision)}</span></p>
            <p>desired 更新时间：<span className="text-text-primary">{timestamp(data?.desired.updatedAt)}</span></p>
            <p>Dream policy 状态：<span className="font-mono text-text-primary">{runtime?.config.policy_status ?? "未知"}</span></p>
            <p>Dream 加载时间：<span className="text-text-primary">{timestamp(runtime?.config.loaded_at)}</span></p>
            <p className="min-w-0">effective version：<span className="break-all font-mono text-text-primary" title={runtime?.config.effective_version}>{runtime?.config.effective_version ?? "未知"}</span></p>
          </div>
          {data?.application.status === "pending" ? (
            <div className="mt-5 border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-primary" role="status">
              <p className="font-semibold">期望配置已保存，等待 Dream 下次定时读取后生效</p>
              <p className="mt-1 text-text-secondary">PostgreSQL desired revision {value(data.desired.revision)} 已更新；当前运行中的 Dream 暂时仍使用上方 effective 值，应用完成后控制台会自动刷新，无需重启。</p>
            </div>
          ) : data?.application.status === "applied" ? (
            <div className="mt-5 border border-success/35 bg-success-light p-4 text-sm text-success" role="status">
              Dream 已加载 desired revision {value(data.desired.revision)}，四项策略现已生效。
            </div>
          ) : null}
          <div className="-mx-5 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg-secondary/35 px-5 py-4" aria-live="polite">
            <p className="text-sm text-text-secondary">
              {draftInvalid
                ? "配置尚未保存：请先修正标红字段。"
                : form !== null
                  ? "有尚未保存的策略修改。"
                  : mutation.isSuccess
                    ? `已保存 desired revision ${value(data?.desired.revision)}。`
                    : "修改任一阈值后即可保存。"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {form !== null ? <button type="button" className="min-h-11 border border-border bg-bg-surface px-4 text-sm font-semibold text-text-primary" disabled={mutation.isPending} onClick={() => {
                setForm(null);
                setEditBaseRevision(undefined);
                mutation.reset();
              }}>撤销修改</button> : null}
              {writeAccess.data?.can ? <button type="button" disabled={saveButton.disabled} onClick={() => {
                if (!displayedForm || draftInvalid || revisionChangedWhileEditing) return;
                if (!window.confirm("将 desired 配置保存到 PostgreSQL；Dream 会定时读取并动态应用，无需重启。继续吗？")) return;
                mutation.mutate({
                  values: displayedForm,
                  expectedRevision: editBaseRevision ?? null,
                });
              }} className={CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS}>{saveButton.label}</button> : null}
            </div>
          </div>
          {revisionChangedWhileEditing ? <p className="mt-3 text-sm text-danger" role="alert">desired 配置已被其他管理员更新。请刷新后重新编辑，当前草稿不会覆盖新 revision。</p> : null}
          {mutation.error ? <p className="mt-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
        </section>

        <section className="min-w-0 border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-semibold">Turn 与进程</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            {[
              ["开始", runtime?.turns.started_total], ["完成", runtime?.turns.completed_total],
              ["失败", runtime?.turns.failed_total], ["取消", runtime?.turns.cancelled_total],
              ["Claude 子进程", runtime?.claude_processes.count], ["子进程总 RSS", bytes(runtime?.claude_processes.total_rss_bytes)],
            ].map(([label, metric]) => <div key={String(label)}><dt className="text-xs text-text-tertiary">{label}</dt><dd className="mt-1 font-mono text-lg">{value(metric)}</dd></div>)}
          </dl>
          <div className="mt-5 border-t border-border pt-4 text-sm text-text-secondary">
            <p>进程观测可用：{runtime ? value(runtime.claude_processes.available) : "未知"}</p>
            <p className="mt-1">最近拒绝：{value(runtime?.admission.last_denial_type)}</p>
            <p className="mt-1">拒绝时间：{timestamp(runtime?.admission.last_denial_at)}</p>
          </div>
        </section>
      </div>

      <section className="border border-border bg-surface p-5">
        <h2 className="font-display text-xl font-semibold">Linux / cgroup v2 内存</h2>
        <div className="mt-5 grid gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">{memoryRows.map(([label, metric]) => <div key={label}><p className="text-xs text-text-tertiary">{label}</p><p className="mt-1 font-mono text-lg">{metric}</p></div>)}</div>
        <div className="mt-5 border-t border-border pt-4"><p className="text-xs text-text-tertiary">memory.events（累计）</p><p className="mt-2 font-mono text-sm">{runtime ? Object.entries(runtime.memory.events).map(([key, metric]) => `${key}=${value(metric)}`).join("  ·  ") : "未知"}</p></div>
      </section>

      <section className="border border-border bg-surface p-5">
        <h2 className="font-display text-xl font-semibold">观测管线健康</h2>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-5">
          <p>sample：<span className="font-mono text-text-primary">{runtime?.sample.status ?? "未知"}</span></p>
          <p>sample stale：<span className="font-mono text-text-primary">{value(runtime?.sample.stale)}</span></p>
          <p>queue dropped：<span className="font-mono text-text-primary">{value(runtime?.pipeline.queue_dropped_total)}</span></p>
          <p>write errors：<span className="font-mono text-text-primary">{value(runtime?.pipeline.write_errors_total)}</span></p>
          <p>最近写错误：<span className="text-text-primary">{timestamp(runtime?.pipeline.last_write_error_at)}</span></p>
        </div>
        {runtime?.sample.error_code ? <p className="mt-4 text-sm text-danger">采样降级：{runtime.sample.error_code}</p> : null}
      </section>
    </div>
  );
}
