"use client";

import { useQuery } from "@tanstack/react-query";

type Metrics = {
  platformUsers: number;
  sourceUsers: number;
  storyWorkspaces: number;
  storyStories: number;
  pendingStoryReviews: number;
  activeModels: number;
  requestsToday: number;
  tokensToday: string;
  chargedTodayMicrousd: string;
  settlementFailures: number;
};

function money(microusd: string) {
  const value = BigInt(microusd || "0");
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}$${(absolute / 1_000_000n).toString()}.${(absolute % 1_000_000n).toString().padStart(6, "0")}`;
}

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
    return <div className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert"><p className="font-semibold">运营数据暂时不可用</p><p className="mt-1">{query.error.message}</p><button type="button" onClick={() => query.refetch()} className="mt-3 min-h-10 underline">重新加载</button></div>;
  }

  const metrics = query.data;
  const rows = [
    { group: "业务源", label: "真实业务用户", value: metrics?.sourceUsers, note: "users" },
    { group: "业务源", label: "工作区 / 剧本", value: metrics ? `${metrics.storyWorkspaces} / ${metrics.storyStories}` : undefined, note: "source PostgreSQL" },
    { group: "待处理", label: "待审核剧本", value: metrics?.pendingStoryReviews, note: "review_status=pending" },
    { group: "模型", label: "启用模型", value: metrics?.activeModels, note: "ai_models.enabled" },
    { group: "今日网关", label: "请求 / Token", value: metrics ? `${metrics.requestsToday} / ${metrics.tokensToday}` : undefined, note: "自今日 00:00" },
    { group: "今日计费", label: "已计费金额", value: metrics ? money(metrics.chargedTodayMicrousd) : undefined, note: "micro-USD 汇总" },
    { group: "待处理", label: "异常结算", value: metrics?.settlementFailures, note: "settlement_failed" },
  ];

  return (
    <section className="admin-panel overflow-hidden" aria-labelledby="dashboard-metrics-title">
      <header className="border-b border-border px-5 py-4"><h2 id="dashboard-metrics-title" className="font-display text-lg font-semibold">实时运营快照</h2><p className="mt-1 text-xs text-text-tertiary">全部数值来自受保护 API，每 60 秒刷新。</p></header>
      <dl className="grid sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <div key={`${row.group}-${row.label}`} className="border-b border-border p-5 sm:border-r xl:[&:nth-child(4n)]:border-r-0"><dt><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">{row.group}</span><span className="mt-2 block text-xs text-text-secondary">{row.label}</span></dt><dd className="mt-2 font-mono text-xl font-semibold text-text-primary">{row.value ?? "—"}</dd><p className="mt-2 font-mono text-[9px] text-text-tertiary">{row.note}</p></div>
        ))}
      </dl>
    </section>
  );
}
