import Link from "next/link";

import CompatibilityProbeButton from "./_components/CompatibilityProbeButton";

const releaseStages = [
  {
    id: "S0",
    title: "路由与运行时",
    detail: "Refine Core、Next Router、显式路由",
    state: "current",
  },
  {
    id: "S1",
    title: "身份与协议",
    detail: "IdP、RBAC、Admin API contracts",
    state: "locked",
  },
  {
    id: "S2",
    title: "不可变审计",
    detail: "事务边界与只读审计资源",
    state: "locked",
  },
  {
    id: "S3–S4",
    title: "资源与发布",
    detail: "Customers、Todos、Settings、验证",
    state: "locked",
  },
] as const;

const boundaries = [
  {
    label: "Routing",
    title: "显式 /admin 路由树",
    detail: "不使用 catch-all，不接管现有 PWA 页面。",
  },
  {
    label: "State",
    title: "共享 QueryClient",
    detail: "Refine 复用根缓存实例，不创建第二套全局状态。",
  },
  {
    label: "Security",
    title: "资源保持关闭",
    detail: "真实 IdP 与服务端 RBAC 完成前，不暴露管理 CRUD。",
  },
];

export default function AdminOverviewPage() {
  return (
    <div className="animate-fadeUp">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-tertiary">
            Control plane / route shell
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            Refine 管理后台兼容性基座
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-success-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-success">
            Refine mounted
          </span>
          <Link
            href="/admin/login"
            className="rounded-full border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            查看身份状态
          </Link>
        </div>
      </header>

      <section className="grid gap-8 border-b border-border py-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:py-14">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-accent-orange" aria-hidden="true" />
            S0 · evidence before access
          </div>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.35rem,6vw,5.4rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-text-primary">
            管理不是入口，
            <span className="text-accent">是边界。</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-text-secondary sm:text-lg">
            这个壳层先证明 Next.js、Refine 和现有 PWA 可以共存。身份、权限、审计和业务资源会在各自 gate
            通过后逐步解锁。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CompatibilityProbeButton />
            <span className="font-mono text-[11px] text-text-tertiary">
              /admin/compatibility/:id
            </span>
          </div>
        </div>

        <aside className="rounded-[28px] border border-border bg-bg-surface p-5 shadow-subtle sm:p-6" aria-label="发布阶段">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Release rail</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              1 / 4 active
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
              S0 boundaries
            </p>
            <h2 id="boundary-heading" className="mt-3 font-display text-2xl font-semibold text-text-primary sm:text-3xl">
              当前真实可用的能力
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-text-secondary">
            这里只陈述已经落到代码的边界，不展示尚不存在的运营指标。
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
