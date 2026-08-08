"use client";

import { useQuery } from "@tanstack/react-query";

type Metrics = {
  platformUsers: number;
  storyProjects: number;
  activeModels: number;
  requestsToday: number;
  tokensToday: number;
  chargedTodayMicrousd: string;
  settlementFailures: number;
};

function money(microusd: string) {
  const value = BigInt(microusd || "0");
  return `$${(value / 1_000_000n).toString()}.${(value % 1_000_000n).toString().padStart(6, "0")}`;
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
    return <p className="mt-6 rounded-xl bg-danger-light p-4 text-sm text-danger">{query.error.message}</p>;
  }

  const metrics = query.data;
  const cards = [
    ["平台用户", metrics?.platformUsers],
    ["剧本项目", metrics?.storyProjects],
    ["启用模型", metrics?.activeModels],
    ["今日请求", metrics?.requestsToday],
    ["今日 Token", metrics?.tokensToday],
    ["今日计费", metrics ? money(metrics.chargedTodayMicrousd) : undefined],
    ["待人工结算", metrics?.settlementFailures],
  ] as const;

  return (
    <section className="grid gap-3 py-6 sm:grid-cols-2 xl:grid-cols-7" aria-label="实时运营指标">
      {cards.map(([label, value]) => (
        <article key={label} className="rounded-2xl border border-border bg-bg-surface p-4 shadow-subtle">
          <p className="text-xs text-text-tertiary">{label}</p>
          <p className="mt-2 font-mono text-xl font-semibold text-text-primary">{value ?? "—"}</p>
        </article>
      ))}
    </section>
  );
}
