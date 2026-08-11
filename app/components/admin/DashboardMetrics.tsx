"use client";

import { useQuery } from "@tanstack/react-query";

type Metrics = {
  platformUsers: number;
  sourceUsers: number | null;
  storyWorkspaces: number | null;
  storyStories: number | null;
  draftStories?: number;
  publishedStories?: number;
  pendingStoryReviews: number | null;
  activeModels: number;
  requestsToday: number;
  tokensToday: string;
  chargedTodayMicrousd: string;
  settlementFailures: number;
  storySource: {
    state: "ready" | "migration_required";
    missingTables: string[];
  };
  recentStories?: Array<Record<string, unknown>>;
  recentOperations?: Array<Record<string, unknown>>;
};

export default function DashboardMetrics() {
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const response = await fetch("/api/admin/dashboard", { headers: { accept: "application/json" } });
      const body = (await response.json()) as { data?: Metrics; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Dashboard data unavailable");
      return body.data;
    },
    refetchInterval: 60_000,
  });

  if (query.error) {
    return <div className="bg-danger-light p-5 text-sm text-danger" role="alert"><p className="font-semibold">运营数据暂时不可用</p><p className="mt-1">{query.error.message}</p><button type="button" onClick={() => query.refetch()} className="mt-3 min-h-10 underline">重新加载</button></div>;
  }

  const metrics = query.data;
  const rows = [
    { group: "业务源", label: "真实业务用户", value: metrics?.sourceUsers, note: "users（Dream 无 status 字段）" },
    { group: "业务源", label: "真实工作区", value: metrics?.storyWorkspaces, note: "story_workspace_workspaces" },
    { group: "业务源", label: "剧本 / 草稿 / 发布", value: metrics?.storyStories === null ? null : metrics ? `${metrics.storyStories} / ${metrics.draftStories ?? "—"} / ${metrics.publishedStories ?? "—"}` : undefined, note: "story_workspace_stories" },
    { group: "待处理", label: "待审核剧本", value: metrics?.pendingStoryReviews, note: "review_status=pending" },
  ];

  return (
    <section aria-labelledby="dashboard-metrics-title">
      <header><h2 id="dashboard-metrics-title" className="font-display text-2xl font-semibold tracking-[-0.03em]">实时数据</h2><p className="mt-2 text-xs text-text-tertiary">每 60 秒刷新</p></header>
      {metrics?.storySource.state === "migration_required" ? (
        <div className="mt-5 bg-accent-orange-light px-5 py-4 text-sm text-text-secondary" role="status">
          <p className="font-semibold text-text-primary">Story 业务表尚未迁入当前 ink-memory</p>
          <p className="mt-1 leading-6">模型、网关、计费、权限和 Storage 可继续使用。待迁入：<span className="font-mono text-xs">{metrics.storySource.missingTables.join(", ")}</span></p>
        </div>
      ) : null}
      <dl className="mt-8 grid gap-x-12 gap-y-10 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <div key={`${row.group}-${row.label}`}><dt className="text-xs text-text-secondary">{row.label}</dt><dd className="mt-4 font-mono text-3xl font-semibold tracking-[-0.04em] text-text-primary">{row.value ?? "—"}</dd></div>
        ))}
      </dl>
      {metrics ? (
        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <section>
            <h3 className="font-display text-lg font-semibold">最近更新 Story</h3>
            <div className="mt-3 space-y-1">
              {(metrics.recentStories ?? []).map((item) => (
                <a key={String(item.id)} href={`/admin/story/stories?story=${encodeURIComponent(String(item.id))}`} className="block py-3 text-sm hover:underline">
                  <span className="font-semibold">{String(item.title)}</span>
                  <span className="mt-1 block text-xs text-text-tertiary">{String(item.workspace_name)} · {new Date(String(item.updated_at)).toLocaleString()}</span>
                </a>
              ))}
              {(metrics.recentStories ?? []).length === 0 ? <p className="py-3 text-sm text-text-tertiary">尚无 Story。</p> : null}
            </div>
          </section>
          <section>
            <h3 className="font-display text-lg font-semibold">最近管理操作</h3>
            <div className="mt-3 space-y-1">
              {(metrics.recentOperations ?? []).map((item) => (
                <a key={String(item.id)} href={`/admin/system/audit?filter[resource_id][eq]=${encodeURIComponent(String(item.resource_id ?? ""))}`} className="block py-3 text-sm hover:underline">
                  <span className="font-semibold">{String(item.action)} · {String(item.resource_type)}</span>
                  <span className="mt-1 block text-xs text-text-tertiary">{String(item.actor_email ?? item.actor_id ?? "system")} · {new Date(String(item.created_at)).toLocaleString()}</span>
                </a>
              ))}
              {(metrics.recentOperations ?? []).length === 0 ? <p className="py-3 text-sm text-text-tertiary">尚无管理操作。</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
