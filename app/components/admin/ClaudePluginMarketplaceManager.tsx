// [Input] Admin Remote Marketplace APIs, Refine permission projection, and React Query cache invalidation.
// [Output] Operator UI for source registration, visible persisted sync progress/errors, immutable revision review, and entry approval/blocking.
// [Pos] Admin resource manager for the one platform-global ClaudePlugin Marketplace catalog.
// [Sync] 2026-08-19: implement the no-bucket Remote Marketplace operations workbench.
// [Sync] 2026-09-02: surface synchronization progress, durable failure context, and explicit retry feedback.

"use client";

import { FormEvent, useEffect, useState } from "react";
import { useCan } from "@refinedev/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type MarketplaceSummary = {
  id: string;
  slug: string;
  display_name: string;
  remote_url: string;
  default_ref: string | null;
  marketplace_name: string | null;
  status: "pending" | "active" | "disabled" | "error";
  latest_revision_id: string | null;
  latest_commit_sha: string | null;
  latest_validation_status: "valid" | "invalid" | null;
  latest_synced_at: string | null;
  entry_count: number;
  approved_count: number;
  last_sync_error_code?: string | null;
  last_sync_error_summary?: string | null;
};

type MarketplaceDetail = MarketplaceSummary & {
  revisions: Array<{
    id: string;
    resolved_commit_sha: string;
    marketplace_name: string;
    manifest_sha256: string;
    entry_count: number;
    validation_status: "valid" | "invalid";
    validation_errors: string[];
    created_at: string;
  }>;
  policies: Array<{
    id: string;
    package_name: string;
    decision: "approved" | "blocked";
    approved_entry_id: string | null;
    revision_id: string | null;
    version: string | null;
  }>;
};

type MarketplaceEntry = {
  id: string;
  package_name: string;
  package_spec: string;
  description: string | null;
  version: string | null;
  homepage: string | null;
  source_path: string;
  plugin_digest: string | null;
  component_inventory_json: Record<string, number>;
  validation_status: "valid" | "invalid";
  validation_errors: string[];
  decision: "approved" | "blocked" | null;
  approved_entry_id: string | null;
  policy_reason: string | null;
};

type MarketplaceRevision = {
  id: string;
  resolved_commit_sha: string;
  manifest_sha256: string;
  validation_status: "valid" | "invalid";
  validation_errors: string[];
  created_at: string;
  entries: MarketplaceEntry[];
};

type MarketplaceSyncRun = {
  id: string;
  status: "running" | "succeeded" | "failed";
  requested_ref: string | null;
  resolved_commit_sha: string | null;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
};

type Feedback = {
  tone: "success" | "error";
  title: string;
  message: string;
};

type ApiEnvelope<T> = {
  data: T;
  error?: { code?: string; message?: string };
};

class MarketplaceApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
  ) {
    super(message);
    this.name = "MarketplaceApiError";
  }
}

const SYNC_RUN_POLL_INTERVAL_MS = 1_500;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok) {
    throw new MarketplaceApiError(
      body.error?.message ?? "Marketplace 操作失败",
      body.error?.code ?? null,
    );
  }
  return body.data;
}

function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : "—";
}

function statusLabel(status: MarketplaceSummary["status"]) {
  return {
    pending: "待同步",
    active: "可用",
    disabled: "已停用",
    error: "需处理",
  }[status];
}

function StatusPill({ status }: { status: MarketplaceSummary["status"] }) {
  const tone = status === "active"
    ? "border-success/35 bg-success-light text-success"
    : status === "error"
      ? "border-danger/35 bg-danger-light text-danger"
      : "border-border bg-bg-secondary text-text-secondary";
  return <span className={`inline-flex border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${tone}`}>{statusLabel(status)}</span>;
}

function syncErrorGuidance(code?: string | null) {
  switch (code) {
    case "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT":
      return "服务器在同步时限内没有收到远程响应。请检查远程网络后重试；已批准版本不会被覆盖。";
    case "CLAUDE_PLUGIN_MARKETPLACE_GIT_FAILED":
    case "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_FETCH_FAILED":
      return "服务器无法读取远程仓库。请确认仓库可公开访问，并在网络恢复后重试。";
    case "CLAUDE_PLUGIN_MARKETPLACE_REF_NOT_FOUND":
      return "仓库或固定 ref 不存在。请核对登记的仓库地址与 branch/tag。";
    case "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_RATE_LIMITED":
      return "远程服务暂时限制访问。稍后重试即可，现有已批准版本不受影响。";
    case "CLAUDE_PLUGIN_MARKETPLACE_MANIFEST_INVALID":
    case "CLAUDE_PLUGIN_MARKETPLACE_REVISION_INVALID":
      return "远程内容已读取，但 Marketplace 清单或插件内容未通过校验。请修正上游内容后重试。";
    default:
      return "同步没有完成。核对错误代码与仓库状态后重试；现有已批准版本不会被覆盖。";
  }
}

export default function ClaudePluginMarketplaceManager() {
  const queryClient = useQueryClient();
  const access = useCan({ resource: "claude-plugin-marketplaces", action: "create" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const listQuery = useQuery<MarketplaceSummary[]>({
    queryKey: ["admin-claude-plugin-marketplaces"],
    queryFn: () => api("/api/admin/claude-plugin-marketplaces"),
  });

  useEffect(() => {
    if (!selectedId && listQuery.data?.[0]) setSelectedId(listQuery.data[0].id);
    if (selectedId && listQuery.data && !listQuery.data.some((item) => item.id === selectedId)) {
      setSelectedId(listQuery.data[0]?.id ?? null);
    }
  }, [listQuery.data, selectedId]);

  const detailQuery = useQuery<MarketplaceDetail>({
    queryKey: ["admin-claude-plugin-marketplace", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => api(`/api/admin/claude-plugin-marketplaces/${encodeURIComponent(selectedId!)}`),
  });

  useEffect(() => {
    const revisions = detailQuery.data?.revisions ?? [];
    if (!revisionId || !revisions.some((revision) => revision.id === revisionId)) {
      setRevisionId(revisions[0]?.id ?? null);
    }
  }, [detailQuery.data, revisionId]);

  const revisionQuery = useQuery<MarketplaceRevision>({
    queryKey: ["admin-claude-plugin-marketplace-revision", selectedId, revisionId],
    enabled: Boolean(selectedId && revisionId),
    queryFn: () => api(
      `/api/admin/claude-plugin-marketplaces/${encodeURIComponent(selectedId!)}/revisions/${encodeURIComponent(revisionId!)}`,
    ),
  });

  const runsQuery = useQuery<MarketplaceSyncRun[]>({
    queryKey: ["admin-claude-plugin-marketplace-runs", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => api(
      `/api/admin/claude-plugin-marketplaces/${encodeURIComponent(selectedId!)}/runs`,
    ),
    refetchInterval: (query) => {
      const runs = query.state.data as MarketplaceSyncRun[] | undefined;
      return pendingAction === "sync" || runs?.some((run) => run.status === "running")
        ? SYNC_RUN_POLL_INTERVAL_MS
        : false;
    },
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin-claude-plugin-marketplaces"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-claude-plugin-marketplace"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-claude-plugin-marketplace-revision"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-claude-plugin-marketplace-runs"] });
  }

  async function createMarketplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPendingAction("create");
    setFeedback(null);
    try {
      const created = await api<MarketplaceSummary>("/api/admin/claude-plugin-marketplaces", {
        method: "POST",
        body: JSON.stringify({
          slug: String(data.get("slug") ?? ""),
          displayName: String(data.get("displayName") ?? ""),
          remoteUrl: String(data.get("remoteUrl") ?? ""),
          ...(String(data.get("defaultRef") ?? "").trim()
            ? { defaultRef: String(data.get("defaultRef")) }
            : {}),
        }),
      });
      form.reset();
      setSelectedId(created.id);
      setFeedback({
        tone: "success",
        title: "远程来源已登记",
        message: "同步成功并显式批准条目后，Dream 用户才会看到插件。",
      });
      await refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        title: "来源登记失败",
        message: error instanceof Error ? error.message : "请检查输入后重试。",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function syncMarketplace() {
    if (!selectedId) return;
    setPendingAction("sync");
    setFeedback(null);
    try {
      const result = await api<{ entryCount: number; validationStatus: string }>(
        `/api/admin/claude-plugin-marketplaces/${encodeURIComponent(selectedId)}/sync`,
        { method: "POST", body: "{}" },
      );
      setFeedback({
        tone: "success",
        title: "同步完成",
        message: `${result.entryCount} 个条目已形成不可变 revision，等待逐项批准。`,
      });
      setRevisionId(null);
      await refresh();
    } catch (error) {
      const code = error instanceof MarketplaceApiError ? error.code : null;
      setFeedback({
        tone: "error",
        title: "同步失败",
        message: `${error instanceof Error ? error.message : "同步没有完成"} ${syncErrorGuidance(code)}`,
      });
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  async function setMarketplaceStatus(status: "active" | "disabled") {
    if (!selectedId) return;
    setPendingAction("status");
    setFeedback(null);
    try {
      await api(`/api/admin/claude-plugin-marketplaces/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setFeedback({
        tone: "success",
        title: status === "disabled" ? "来源已停用" : "来源已启用",
        message: status === "disabled"
          ? "Dream 目录会立即隐藏该来源的条目。"
          : "只有已批准的有效条目会进入 Dream 目录。",
      });
      await refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        title: "状态更新失败",
        message: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function updatePolicy(entry: MarketplaceEntry, decision: "approved" | "blocked") {
    if (!selectedId) return;
    setPendingAction(`policy:${entry.id}`);
    setFeedback(null);
    try {
      await api(
        `/api/admin/claude-plugin-marketplaces/${encodeURIComponent(selectedId)}/entries/${encodeURIComponent(entry.package_name)}/policy`,
        {
          method: "PUT",
          body: JSON.stringify({
            decision,
            ...(decision === "approved" ? { entryId: entry.id } : {}),
          }),
        },
      );
      setFeedback({
        tone: "success",
        title: decision === "approved" ? "全局版本已批准" : "条目已阻断",
        message: decision === "approved"
          ? `${entry.package_spec} 已批准为全局目录版本。`
          : `${entry.package_spec} 已从全局目录阻断。`,
      });
      await refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        title: "策略更新失败",
        message: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setPendingAction(null);
    }
  }

  const selected = detailQuery.data;
  const entries = revisionQuery.data?.entries ?? [];
  const latestRun = runsQuery.data?.[0] ?? null;
  const runningRun = runsQuery.data?.find((run) => run.status === "running") ?? null;
  const isSyncing = pendingAction === "sync" || Boolean(runningRun);

  return <div className="space-y-6">
    <section className="admin-panel grid gap-6 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:p-7">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">Global remote catalog</p>
        <h2 className="mt-3 font-display text-2xl font-semibold">登记远程 Marketplace</h2>
        <p className="mt-3 max-w-xl text-sm leading-7 text-text-secondary">
          平台只保存远程 URL、commit、manifest 摘要、校验结果与批准策略。同步 checkout 使用临时目录并在任务后清理，不上传 Marketplace 桶，也不按 Dream 用户复制目录。
        </p>
        <ol className="mt-6 grid gap-3 text-sm text-text-secondary sm:grid-cols-3">
          {["1 · 登记 HTTPS Git", "2 · 同步并审阅", "3 · 批准全局版本"].map((step) => <li key={step} className="border-t border-border pt-3 font-semibold">{step}</li>)}
        </ol>
      </div>
      {access.data?.can ? <form onSubmit={createMarketplace} className="grid gap-4 border-l-0 border-border lg:border-l lg:pl-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold text-text-secondary">来源标识<input className="admin-field mt-2 block text-sm" name="slug" required pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="comfy-skills" /></label>
          <label className="text-xs font-semibold text-text-secondary">运营名称<input className="admin-field mt-2 block text-sm" name="displayName" required placeholder="Comfy Skills" /></label>
        </div>
        <label className="text-xs font-semibold text-text-secondary">HTTPS Git URL<input className="admin-field mt-2 block text-sm" name="remoteUrl" required type="url" placeholder="https://github.com/org/repository" /></label>
        <label className="text-xs font-semibold text-text-secondary">固定 ref（可选）<input className="admin-field mt-2 block text-sm" name="defaultRef" placeholder="branch 或 tag" /></label>
        <button disabled={pendingAction === "create"} className="min-h-11 justify-self-start bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-40">{pendingAction === "create" ? "登记中…" : "登记远程来源"}</button>
      </form> : <p className="border border-border bg-bg-secondary p-4 text-sm text-text-secondary">当前角色没有 Marketplace 管理权限。</p>}
    </section>

    {feedback ? <section
      className={`border p-4 ${feedback.tone === "error" ? "border-danger/35 bg-danger-light text-danger" : "border-success/35 bg-success-light text-success"}`}
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-live={feedback.tone === "error" ? "assertive" : "polite"}
    >
      <p className="text-sm font-semibold">{feedback.title}</p>
      <p className="mt-1 text-xs leading-5">{feedback.message}</p>
    </section> : null}

    <section className="grid min-h-[560px] gap-0 overflow-hidden border border-border bg-bg-surface lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="border-b border-border bg-bg-secondary/30 lg:border-b-0 lg:border-r">
        <div className="border-b border-border px-5 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Sources</p>
          <h2 className="mt-2 font-display text-xl font-semibold">远程来源</h2>
        </div>
        {listQuery.isLoading ? <p className="p-5 text-sm text-text-tertiary">正在读取来源…</p> : null}
        {listQuery.error ? <div className="p-5 text-sm text-danger" role="alert">{listQuery.error.message}<button type="button" onClick={() => listQuery.refetch()} className="mt-3 block min-h-10 underline">重新加载</button></div> : null}
        {!listQuery.isLoading && !listQuery.error && listQuery.data?.length === 0 ? <div className="p-6"><p className="font-display text-lg font-semibold">尚无远程来源</p><p className="mt-2 text-sm leading-6 text-text-tertiary">先登记 Git URL；未同步和未批准的内容不会进入 Dream。</p></div> : null}
        <div className="divide-y divide-border">
          {listQuery.data?.map((item) => <button
            key={item.id}
            type="button"
            onClick={() => { setSelectedId(item.id); setRevisionId(null); }}
            aria-pressed={selectedId === item.id}
            className={`w-full px-5 py-4 text-left transition-colors hover:bg-bg-secondary ${selectedId === item.id ? "bg-bg-secondary" : ""}`}
          >
            <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.display_name}</span><span className="mt-1 block truncate font-mono text-[10px] text-text-tertiary">{item.marketplace_name ?? item.slug}</span></span><StatusPill status={item.status} /></span>
            <span className="mt-3 flex gap-4 font-mono text-[9px] uppercase tracking-[0.08em] text-text-tertiary"><span>{item.approved_count}/{item.entry_count} approved</span><span>{shortHash(item.latest_commit_sha)}</span></span>
          </button>)}
        </div>
      </div>

      <div className="min-w-0">
        {!selectedId ? <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><p className="font-display text-xl font-semibold">选择一个远程来源</p><p className="mt-2 text-sm text-text-tertiary">在这里同步、审阅 revision，并明确批准 Dream 可见版本。</p></div></div> : null}
        {detailQuery.isLoading ? <p className="p-7 text-sm text-text-tertiary">正在读取来源详情…</p> : null}
        {detailQuery.error ? <div className="m-6 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{detailQuery.error.message}</div> : null}
        {selected ? <>
          <header className="border-b border-border px-5 py-6 sm:px-7">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3"><h2 className="font-display text-2xl font-semibold">{selected.display_name}</h2><StatusPill status={selected.status} /></div>
                <p className="mt-2 break-all font-mono text-[10px] leading-5 text-text-tertiary">{selected.remote_url}</p>
                <p className="mt-3 text-sm text-text-secondary">全局目录名：<strong>{selected.marketplace_name ?? "尚未同步"}</strong> · ref：{selected.default_ref ?? "远程默认分支"}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" disabled={Boolean(pendingAction) || isSyncing} onClick={syncMarketplace} aria-describedby={isSyncing ? "marketplace-sync-progress" : undefined} className="min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface disabled:opacity-40">{isSyncing ? "同步中…" : "同步远程"}</button>
                <button type="button" disabled={Boolean(pendingAction)} onClick={() => setMarketplaceStatus(selected.status === "disabled" ? "active" : "disabled")} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">{selected.status === "disabled" ? "重新启用" : "停用来源"}</button>
              </div>
            </div>
          </header>

          {isSyncing ? <section
            id="marketplace-sync-progress"
            className="border-b border-border bg-bg-secondary/35 px-5 py-5 sm:px-7"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-text-tertiary border-t-text-primary motion-reduce:animate-pulse" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">正在读取并校验远程 Marketplace</p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">
                  正在解析固定 revision、下载远程内容并检查插件清单。完成前不会改动已批准版本。
                </p>
                {runningRun ? <p className="mt-2 font-mono text-[10px] text-text-tertiary">
                  开始于 {new Date(runningRun.started_at).toLocaleString("zh-CN")} · ref {runningRun.requested_ref ?? "远程默认分支"}
                </p> : null}
              </div>
            </div>
            <div className="mt-4 h-1 overflow-hidden bg-border" aria-hidden="true">
              <span className="block h-full w-2/3 animate-pulse bg-text-primary motion-reduce:animate-none" />
            </div>
          </section> : null}

          {!isSyncing && selected.last_sync_error_code ? <section className="border-b border-danger/35 bg-danger-light px-5 py-5 text-danger sm:px-7" role="alert">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm font-semibold">最近一次同步失败</p>
                <p className="mt-1 text-xs leading-5">{selected.last_sync_error_summary ?? "同步没有完成。"}</p>
                <p className="mt-2 text-xs leading-5">{syncErrorGuidance(selected.last_sync_error_code)}</p>
                <p className="mt-2 font-mono text-[10px]">{selected.last_sync_error_code}</p>
              </div>
              <button type="button" disabled={Boolean(pendingAction)} onClick={syncMarketplace} className="min-h-10 shrink-0 border border-danger/35 px-4 text-xs font-semibold disabled:opacity-40">重新同步</button>
            </div>
          </section> : null}

          {runsQuery.error ? <section className="border-b border-danger/35 bg-danger-light px-5 py-4 text-sm text-danger sm:px-7" role="alert">
            无法读取同步进度。<button type="button" onClick={() => runsQuery.refetch()} className="ml-2 min-h-10 text-xs font-semibold underline">重新加载</button>
          </section> : null}

          {!isSyncing && !selected.last_sync_error_code && latestRun?.status === "succeeded" ? <p className="border-b border-border bg-bg-secondary/20 px-5 py-3 text-xs text-text-tertiary sm:px-7" role="status">
            最近同步完成于 {new Date(latestRun.finished_at ?? latestRun.created_at).toLocaleString("zh-CN")} · commit {shortHash(latestRun.resolved_commit_sha)}
          </p> : null}

          <div className="border-b border-border px-5 py-5 sm:px-7">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Immutable revision</p><h3 className="mt-2 font-display text-lg font-semibold">同步版本与条目审批</h3></div>
              {selected.revisions.length > 0 ? <label className="text-xs font-semibold text-text-secondary">审阅 revision<select value={revisionId ?? ""} onChange={(event) => setRevisionId(event.target.value)} className="admin-field mt-1 block min-w-[240px] text-xs">{selected.revisions.map((revision) => <option key={revision.id} value={revision.id}>{new Date(revision.created_at).toLocaleString("zh-CN")} · {shortHash(revision.resolved_commit_sha)} · {revision.validation_status}</option>)}</select></label> : null}
            </div>
            {revisionQuery.data ? <dl className="mt-4 grid gap-3 border-y border-border py-4 text-xs sm:grid-cols-3">
              <div><dt className="text-text-tertiary">Commit</dt><dd className="mt-1 font-mono">{revisionQuery.data.resolved_commit_sha}</dd></div>
              <div><dt className="text-text-tertiary">Manifest SHA-256</dt><dd className="mt-1 truncate font-mono" title={revisionQuery.data.manifest_sha256}>{revisionQuery.data.manifest_sha256}</dd></div>
              <div><dt className="text-text-tertiary">校验</dt><dd className={`mt-1 font-semibold ${revisionQuery.data.validation_status === "valid" ? "text-success" : "text-danger"}`}>{revisionQuery.data.validation_status === "valid" ? "通过" : "未通过"}</dd></div>
            </dl> : null}
          </div>

          {revisionQuery.isLoading ? <p className="p-7 text-sm text-text-tertiary">正在读取 revision…</p> : null}
          {!revisionQuery.isLoading && selected.revisions.length === 0 ? <div className="p-8 text-center"><p className="font-display text-xl font-semibold">等待首次同步</p><p className="mt-2 text-sm text-text-tertiary">同步只形成待审阅 revision，不会自动发布到 Dream。</p></div> : null}
          {entries.length > 0 ? <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead><tr className="border-b border-border bg-bg-secondary/30">{["插件", "组件摘要", "Revision 校验", "全局目录策略", "操作"].map((label) => <th key={label} className="px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{label}</th>)}</tr></thead>
              <tbody>{entries.map((entry) => {
                const approvedHere = entry.decision === "approved" && entry.approved_entry_id === entry.id;
                const inventory = entry.component_inventory_json ?? {};
                return <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                  <td className="max-w-[300px] px-5 py-4"><p className="font-semibold">{entry.package_name}<span className="ml-2 font-mono text-[10px] text-text-tertiary">{entry.version ?? "unversioned"}</span></p><p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary">{entry.description ?? "未提供说明"}</p><p className="mt-2 font-mono text-[9px] text-text-tertiary">{entry.source_path} · {shortHash(entry.plugin_digest)}</p></td>
                  <td className="px-5 py-4 text-xs text-text-secondary"><span>{inventory.skills ?? 0} skills</span><span className="mx-1">·</span><span>{inventory.commands ?? 0} commands</span><span className="mx-1">·</span><span>{inventory.mcpServers ?? 0} MCP</span></td>
                  <td className={`px-5 py-4 text-xs font-semibold ${entry.validation_status === "valid" ? "text-success" : "text-danger"}`}>{entry.validation_status === "valid" ? "通过" : "未通过"}{entry.validation_errors?.length ? <p className="mt-2 max-w-[220px] font-mono text-[9px] font-normal leading-4">{entry.validation_errors.join(" · ")}</p> : null}</td>
                  <td className="px-5 py-4"><span className={`font-mono text-[10px] uppercase ${approvedHere ? "text-success" : entry.decision === "approved" ? "text-warning" : "text-text-tertiary"}`}>{approvedHere ? "当前 revision 已批准" : entry.decision === "approved" ? "旧 revision 已批准" : "阻断"}</span></td>
                  <td className="px-5 py-4"><div className="flex gap-3 whitespace-nowrap">{entry.validation_status === "valid" && !approvedHere ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => updatePolicy(entry, "approved")} className="min-h-10 text-xs font-semibold underline disabled:opacity-40">批准此版本</button> : null}{entry.decision === "approved" ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => updatePolicy(entry, "blocked")} className="min-h-10 text-xs font-semibold text-danger underline disabled:opacity-40">阻断</button> : null}</div></td>
                </tr>;
              })}</tbody>
            </table>
          </div> : null}
        </> : null}
      </div>
    </section>
  </div>;
}
