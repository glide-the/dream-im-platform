import Link from "next/link";

export default function AdminLoginPage() {
  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden bg-bg-primary px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] lg:p-0">
      <section className="relative hidden border-r border-border bg-text-primary p-10 text-bg-surface lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-bg-surface font-mono text-sm font-semibold tracking-[-0.08em] text-text-primary">
            INK
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-bg-surface/70">/ OPS</span>
        </div>
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-bg-surface/55">
            Internal control plane
          </p>
          <h1 className="mt-6 font-display text-6xl font-semibold leading-[0.98] tracking-[-0.04em] xl:text-7xl">
            先验证身份，
            <br />再开放控制。
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-bg-surface/70">
            管理后台不会创建临时账号或浏览器端管理员旁路。企业身份、稳定 subject 与 callback allowlist
            配置完成后，登录动作才会启用。
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-bg-surface/45">
          exposure · internal-only
        </p>
      </section>

      <section className="relative grid place-items-center">
        <div className="w-full max-w-lg rounded-[32px] border border-border bg-bg-surface p-6 shadow-medium sm:p-9">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-text-primary font-mono text-xs font-semibold tracking-[-0.08em] text-bg-surface">
              INK
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">/ OPS</span>
          </div>

          <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-accent-orange-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-orange lg:mt-0">
            <span className="h-2 w-2 rounded-full bg-accent-orange" aria-hidden="true" />
            configuration required
          </div>
          <h2 className="mt-6 font-display text-3xl font-semibold text-text-primary">身份接入尚未配置</h2>
          <p className="mt-4 text-sm leading-7 text-text-secondary">
            当前没有可核实的生产 IdP、稳定 identity subject 或 callback allowlist。按照 fail-closed
            策略，此页面不会接受账号密码。
          </p>

          <button
            type="button"
            disabled
            className="mt-8 flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-full bg-bg-secondary px-5 py-3 text-sm font-semibold text-text-tertiary"
          >
            使用企业身份继续
          </button>
          <p className="mt-3 text-center text-xs text-text-tertiary">等待部署责任人完成身份配置</p>

          <div className="mt-8 border-t border-border pt-6">
            <Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
              ← 返回兼容性控制台
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
