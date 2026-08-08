import AdminAuthEntry from "./AdminAuthEntry";

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
            先建立信任，
            <br />再开放控制。
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-bg-surface/70">
            第一次启动先创建唯一的超级管理员；之后回到标准登录流程。密码在服务端使用 scrypt
            校验，权限与 Session 每次都由 PostgreSQL 核验。
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-bg-surface/45">
          exposure · internal-only
        </p>
      </section>

      <section className="relative grid place-items-center">
        <div
          role="dialog"
          aria-label="Ink Memory 管理入口"
          className="w-full max-w-xl rounded-[32px] border border-border bg-bg-surface p-6 shadow-medium sm:p-9"
        >
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-text-primary font-mono text-xs font-semibold tracking-[-0.08em] text-bg-surface">
              INK
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">/ OPS</span>
          </div>

          <div className="mt-8 lg:mt-0">
            <AdminAuthEntry />
          </div>
        </div>
      </section>
    </main>
  );
}
