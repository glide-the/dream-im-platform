import Link from "next/link";
import AdminLoginForm from "./AdminLoginForm";

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
            管理员由一次性引导接口或拥有 access.write 的管理员创建。密码在服务端使用 scrypt
            校验，权限和 Session 每次都由数据库核验。
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

          <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-success-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-success lg:mt-0">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            protected session
          </div>
          <h2 className="mt-6 font-display text-3xl font-semibold text-text-primary">登录运营控制台</h2>
          <p className="mt-4 text-sm leading-7 text-text-secondary">
            管理身份、角色和权限均由服务端数据库核验。浏览器不会保存 Provider 密钥或管理 Session 明文。
          </p>
          <AdminLoginForm />

          <div className="mt-8 border-t border-border pt-6">
            <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
              ← 返回应用首页
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
