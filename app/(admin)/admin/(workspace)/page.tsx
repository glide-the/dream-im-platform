import Link from "next/link";
import DashboardMetrics from "@/components/admin/DashboardMetrics";

const releaseStages = [
  {
    id: "AUTH",
    title: "身份与权限",
    detail: "服务端 Session、RBAC、不可变审计",
    state: "current",
  },
  {
    id: "AI",
    title: "模型供应链",
    detail: "Provider、模型别名、分层定价",
    state: "current",
  },
  {
    id: "BILL",
    title: "计费与代理",
    detail: "预授权、Token 结算、Claude / OpenAI",
    state: "current",
  },
  {
    id: "STORY",
    title: "Story 运营域",
    detail: "PostgreSQL 工作区、项目、角色、场景与工作流 CRUD",
    state: "current",
  },
] as const;

const boundaries = [
  {
    label: "Identity",
    title: "服务端权限是唯一边界",
    detail: "Refine 只改善交互；所有 API 重新核验 Session 与 permission。",
  },
  {
    label: "Billing",
    title: "整数金额与不可变流水",
    detail: "micro-USD、定价快照、reserve / capture / release 全链路可追踪。",
  },
  {
    label: "Gateway",
    title: "双协议代理与终态结算",
    detail: "Anthropic 与 OpenAI 分离适配，流式中断不会静默释放成本。",
  },
];

export default function AdminOverviewPage() {
  return (
    <div className="animate-fadeUp">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-tertiary">
            AI creation platform / control plane
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            模型、Token、代理与用户运营控制台
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-success-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-success">
            Protected · online
          </span>
          <Link
            href="/admin/models"
            className="rounded-full border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            管理模型
          </Link>
        </div>
      </header>

      <DashboardMetrics />

      <section className="grid gap-8 border-b border-border py-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:py-14">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-accent-orange" aria-hidden="true" />
            OPERATIONS · BILLING · GATEWAY
          </div>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.35rem,6vw,5.4rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-text-primary">
            把模型成本，
            <span className="text-accent">变成可运营资产。</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-text-secondary sm:text-lg">
            Refine 负责清晰的运营交互；服务端负责身份、权限、Story 数据、计价、账本和代理执行。
            全部控制面数据统一落在 Ink Memory PostgreSQL。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/admin/users" className="rounded-full bg-text-primary px-5 py-3 text-sm font-semibold text-bg-surface">
              进入用户中心
            </Link>
            <Link href="/admin/gateway" className="rounded-full border border-border px-5 py-3 text-sm font-semibold text-text-primary">
              查看代理请求
            </Link>
          </div>
        </div>

        <aside className="rounded-[28px] border border-border bg-bg-surface p-5 shadow-subtle sm:p-6" aria-label="发布阶段">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Release rail</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              4 / 4 active
            </span>
          </div>
          <ol className="mt-6 space-y-0">
            {releaseStages.map((stage, index) => (
              <li key={stage.id} className="relative grid grid-cols-[32px_1fr] gap-3 pb-6 last:pb-0">
                {index < releaseStages.length - 1 ? (
                  <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-border" aria-hidden="true" />
                ) : null}
                <span
                  className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border font-mono text-[9px] font-semibold ${
                    stage.state === "current"
                      ? "border-accent-orange bg-accent-orange-light text-accent-orange"
                      : "border-border bg-bg-secondary text-text-tertiary"
                  }`}
                >
                  {stage.id}
                </span>
                <div className="pt-1">
                  <p className={`text-sm font-semibold ${stage.state === "current" ? "text-text-primary" : "text-text-tertiary"}`}>
                    {stage.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-text-tertiary">{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="py-10 lg:py-12" aria-labelledby="boundary-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
              System boundaries
            </p>
            <h2 id="boundary-heading" className="mt-3 font-display text-2xl font-semibold text-text-primary sm:text-3xl">
              控制面核心约束
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-text-secondary">
            不展示虚构指标；每个状态都来自受保护的资源 API。
          </p>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {boundaries.map((boundary) => (
            <article key={boundary.label} className="rounded-[24px] border border-border bg-bg-surface p-5 shadow-subtle">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">{boundary.label}</p>
              <h3 className="mt-4 text-base font-semibold text-text-primary">{boundary.title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{boundary.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
