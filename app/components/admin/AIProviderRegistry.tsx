"use client";

import { type CrudFilter, useCan, useList } from "@refinedev/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type ReachabilityState = {
  pending?: boolean;
  status?: "operational" | "degraded" | "failed";
  reachable?: boolean;
  responseTimeMs?: number | null;
  httpStatus?: number | null;
  message?: string;
};

type DiscoveryState = {
  pending?: boolean;
  message?: string;
  status?: "ready" | "failed";
};

function int(value: unknown) {
  return Number(value ?? 0).toLocaleString("zh-CN");
}

function providerHealth(provider: Record<string, unknown>) {
  const active = provider.status === "active";
  const credential = provider.credential_configured === true;
  const enabledModels = Number(provider.enabled_model_count ?? 0);
  if (!active) return { label: "已停用", className: "border-border bg-bg-secondary text-text-tertiary" };
  if (!credential) return { label: "缺少凭据", className: "border-danger/35 bg-danger-light text-danger" };
  if (!enabledModels) return { label: "待配置模型", className: "border-warning/40 bg-accent-orange-light text-accent-orange" };
  return { label: "配置就绪", className: "border-success/35 bg-success-light text-success" };
}

export default function AIProviderRegistry() {
  const router = useRouter();
  const pageSize = 12;
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [reachability, setReachability] = useState<Record<string, ReachabilityState>>({});
  const [discovery, setDiscovery] = useState<Record<string, DiscoveryState>>({});
  const [automaticDiscoveryFailed, setAutomaticDiscoveryFailed] = useState(false);
  const access = useCan({ resource: "providers", action: "create" });
  const filters = useMemo<CrudFilter[]>(
    () =>
      [
        search && { field: "search", operator: "contains" as const, value: search },
        protocol && { field: "protocol", operator: "eq" as const, value: protocol },
        status && { field: "status", operator: "eq" as const, value: status },
      ].filter(Boolean) as CrudFilter[],
    [protocol, search, status],
  );
  const { result, query } = useList<Record<string, unknown>>({
    resource: "providers",
    pagination: { currentPage: page, pageSize },
    sorters: [{ field: "updated_at", order: "desc" }],
    filters,
  });

  useEffect(() => {
    setAutomaticDiscoveryFailed(
      new URLSearchParams(window.location.search).get("discovery") === "failed",
    );
  }, []);

  async function testReachability(providerId: string) {
    setReachability((current) => ({
      ...current,
      [providerId]: { pending: true, message: "正在检查网络可达性…" },
    }));
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(providerId)}/reachability`,
        { method: "POST", headers: { accept: "application/json" } },
      );
      const body = (await response.json().catch(() => ({}))) as {
        data?: ReachabilityState;
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "连通性检查失败");
      }
      setReachability((current) => ({
        ...current,
        [providerId]: body.data ?? {},
      }));
    } catch (error) {
      setReachability((current) => ({
        ...current,
        [providerId]: {
          status: "failed",
          reachable: false,
          message: error instanceof Error ? error.message : "连通性检查失败",
        },
      }));
    }
  }

  async function discoverModels(providerId: string) {
    setDiscovery((current) => ({
      ...current,
      [providerId]: { pending: true, message: "正在读取上游模型目录…" },
    }));
    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(providerId)}/discover`,
        { method: "POST", headers: { accept: "application/json" } },
      );
      const body = (await response.json().catch(() => ({}))) as {
        data?: { id?: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.data?.id) {
        throw new Error(body.error?.message ?? "模型同步失败");
      }
      setDiscovery((current) => ({
        ...current,
        [providerId]: { status: "ready", message: "目录已获取，正在打开差异确认…" },
      }));
      router.push(
        `/admin/models/providers/${encodeURIComponent(providerId)}/discover/${encodeURIComponent(body.data.id)}`,
      );
    } catch (error) {
      setDiscovery((current) => ({
        ...current,
        [providerId]: {
          status: "failed",
          message: error instanceof Error ? error.message : "模型同步失败",
        },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <section className="admin-panel overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Provider registry · proxy supply</p>
            <h2 className="mt-2 font-display text-2xl font-semibold">供应商</h2>
            <p className="mt-1 text-sm text-text-secondary">按 cc-switch 卡片列表组织；每个 Provider 是代理上游，不向调用方分发 Secret。</p>
          </div>
          {access.data?.can ? (
            <Link href="/admin/models/providers/new" className="inline-flex min-h-12 items-center rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-soft hover:brightness-95">
              ＋ 添加 Provider
            </Link>
          ) : null}
        </header>

        {automaticDiscoveryFailed ? (
          <div className="border-b border-warning/40 bg-accent-orange-light px-4 py-3 text-sm text-text-secondary" role="status">
            Provider 已保存，但自动获取模型目录未完成。检查 Endpoint 与 Credential 后，在对应卡片点击“同步模型”重试。
          </div>
        ) : null}

        <div className="grid gap-3 border-b border-border bg-bg-secondary/35 p-4 lg:grid-cols-[minmax(220px,1fr)_auto_auto]">
          <label className="relative block">
            <span className="sr-only">搜索 Provider</span>
            <input className="admin-field min-h-12 rounded-2xl bg-bg-surface pl-4 text-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索名称或 Code" />
          </label>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-bg-secondary p-1" aria-label="协议筛选">
            {[["", "全部"], ["anthropic", "Anthropic"], ["openai", "OpenAI"]].map(([value, label]) => (
              <button key={label} type="button" onClick={() => { setProtocol(value); setPage(1); }} className={`min-h-10 whitespace-nowrap rounded-xl px-4 text-sm font-semibold ${protocol === value ? "bg-bg-surface text-text-primary shadow-soft" : "text-text-tertiary"}`}>{label}</button>
            ))}
          </div>
          <select className="admin-field min-h-12 rounded-2xl bg-bg-surface text-sm" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="运行状态筛选">
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
        </div>

        {query.error ? (
          <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">
            <p className="font-semibold">Provider 注册表暂不可用</p>
            <p className="mt-1">{query.error.message}</p>
            <button type="button" onClick={() => query.refetch()} className="mt-3 min-h-10 underline">重新加载</button>
          </div>
        ) : null}

        <div className="space-y-3 p-4 sm:p-5">
          {query.isLoading ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl border border-border bg-bg-secondary" />) : null}
          {result.data.map((provider) => {
            const providerId = String(provider.id);
            const health = providerHealth(provider);
            const reachabilityResult = reachability[providerId];
            const discoveryResult = discovery[providerId];
            const requests = Number(provider.request_count_24h ?? 0);
            const successes = Number(provider.success_count_24h ?? 0);
            return (
              <article key={String(provider.id)} className="group rounded-2xl border border-border bg-bg-surface p-5 shadow-soft transition hover:-translate-y-px hover:shadow-medium">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-border bg-bg-secondary font-display text-lg font-semibold" aria-hidden="true">{String(provider.name ?? "P").slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold">{String(provider.name)}</h3>
                        <span className="rounded-full border border-border px-2 py-1 font-mono text-[10px] uppercase text-text-tertiary">{String(provider.protocol)}</span>
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${health.className}`}>{health.label}</span>
                      </div>
                      <p className="mt-2 truncate font-mono text-xs text-accent" title={String(provider.base_url)}>{String(provider.base_url)}</p>
                      <p className="mt-2 font-mono text-[10px] text-text-tertiary">{String(provider.code)} · {provider.credential_configured ? `凭据 ${String(provider.api_key_fingerprint ?? "已配置")}` : "凭据未配置"}</p>
                      {reachabilityResult?.message ? (
                        <p
                          className={`mt-2 text-xs ${reachabilityResult.status === "failed" ? "text-danger" : reachabilityResult.status === "degraded" ? "text-accent-orange" : "text-success"}`}
                          role="status"
                        >
                          {reachabilityResult.message}
                          {reachabilityResult.responseTimeMs !== undefined && reachabilityResult.responseTimeMs !== null
                            ? ` · ${reachabilityResult.responseTimeMs} ms`
                            : ""}
                          {reachabilityResult.httpStatus ? ` · HTTP ${reachabilityResult.httpStatus}` : ""}
                        </p>
                      ) : null}
                      {discoveryResult?.message ? (
                        <p className={`mt-2 text-xs ${discoveryResult.status === "failed" ? "text-danger" : "text-accent"}`} role="status">
                          {discoveryResult.message}
                        </p>
                      ) : provider.discovery_at ? (
                        <p className="mt-2 font-mono text-[10px] text-text-tertiary">
                          最近同步 {new Date(String(provider.discovery_at)).toLocaleString("zh-CN")} · {int(provider.discovered_model_count)} 项 · {String(provider.discovery_status ?? "—")}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <dl className="grid grid-cols-3 gap-x-5 gap-y-2 border-y border-border py-4 text-right lg:min-w-[360px] lg:border-x lg:border-y-0 lg:px-6 lg:py-1">
                    <div><dt className="text-[10px] text-text-tertiary">启用模型</dt><dd className="mt-1 font-mono text-sm font-semibold">{int(provider.enabled_model_count)} / {int(provider.model_count)}</dd></div>
                    <div><dt className="text-[10px] text-text-tertiary">24h 请求</dt><dd className="mt-1 font-mono text-sm font-semibold">{int(requests)}</dd></div>
                    <div><dt className="text-[10px] text-text-tertiary">24h 成功率</dt><dd className="mt-1 font-mono text-sm font-semibold">{requests ? `${((successes / requests) * 100).toFixed(1)}%` : "—"}</dd></div>
                  </dl>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    {access.data?.can ? (
                      <button
                        type="button"
                        disabled={discoveryResult?.pending || !provider.credential_configured}
                        onClick={() => discoverModels(providerId)}
                        className="min-h-10 rounded-xl border border-accent/35 bg-accent-light px-3 text-xs font-semibold text-accent hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                        title={provider.credential_configured ? "读取上游模型目录并生成差异快照" : "先配置 Provider Credential"}
                      >
                        {discoveryResult?.pending ? "同步中…" : "同步模型"}
                      </button>
                    ) : null}
                    {access.data?.can ? (
                      <button
                        type="button"
                        disabled={reachabilityResult?.pending}
                        onClick={() => testReachability(providerId)}
                        className="min-h-10 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-bg-secondary disabled:cursor-wait disabled:opacity-60"
                        title="只检查 Endpoint 网络可达性，不发送模型生成请求"
                      >
                        {reachabilityResult?.pending ? "检查中…" : "连通测试"}
                      </button>
                    ) : null}
                    <Link href={`/admin/billing/usage?providerId=${encodeURIComponent(String(provider.id))}`} className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold hover:bg-bg-secondary">监控</Link>
                    <Link href={`/admin/models/models?provider_id=${encodeURIComponent(String(provider.id))}`} className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold hover:bg-bg-secondary">模型</Link>
                    <Link href={`/admin/models/providers/${encodeURIComponent(String(provider.id))}/edit`} className="inline-flex min-h-10 items-center rounded-xl bg-text-primary px-4 text-xs font-semibold text-bg-surface">设置</Link>
                  </div>
                </div>
              </article>
            );
          })}
          {!query.isLoading && !query.error && result.data.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-display text-xl font-semibold">没有匹配的 Provider</p>
              <p className="mt-2 text-sm text-text-tertiary">清除筛选，或从 cc-switch 式预设创建第一个代理上游。</p>
            </div>
          ) : null}
          {!query.error && result.total > pageSize ? (
            <nav className="flex items-center justify-between border-t border-border pt-4" aria-label="Provider 分页">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 rounded-xl border border-border px-4 text-xs font-semibold disabled:opacity-40">上一页</button>
              <span className="font-mono text-xs text-text-tertiary">第 {page} / {Math.max(1, Math.ceil(result.total / pageSize))} 页 · 共 {result.total} 项</span>
              <button type="button" disabled={page * pageSize >= result.total} onClick={() => setPage((current) => current + 1)} className="min-h-10 rounded-xl border border-border px-4 text-xs font-semibold disabled:opacity-40">下一页</button>
            </nav>
          ) : null}
        </div>
      </section>

      <details className="admin-panel overflow-hidden">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">查看 ink-dream-memory 代理接入契约</summary>
        <div className="grid gap-4 border-t border-border p-5 lg:grid-cols-2">
          {[
            ["POST", "/v1/messages", "x-api-key", "messages:create"],
            ["POST", "/v1/messages/count_tokens", "x-api-key", "messages:create"],
            ["POST", "/v1/chat/completions", "Bearer", "chat:create"],
            ["GET", "/v1/models", "Bearer / x-api-key", "models:list"],
          ].map(([method, path, auth, scope]) => (
            <div key={path} className="rounded-xl border border-border bg-bg-surface p-4">
              <p className="font-mono text-xs font-semibold"><span className="mr-2 text-accent">{method}</span>{path}</p>
              <p className="mt-2 text-xs text-text-tertiary">{auth} · scope <code>{scope}</code> · model 使用稳定 alias</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
