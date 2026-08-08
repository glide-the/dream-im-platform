"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const resources = [
  { label: "总览", href: "/admin", permission: "dashboard.read" },
  { label: "剧本数据", href: "/admin/story", permission: "story.read" },
  { label: "平台用户", href: "/admin/users", permission: "users.read" },
  { label: "模型中心", href: "/admin/models", permission: "models.read" },
  { label: "Token 计费", href: "/admin/billing", permission: "billing.read" },
  { label: "代理网关", href: "/admin/gateway", permission: "gateway.read" },
  { label: "权限管理", href: "/admin/access", permission: "access.read" },
  { label: "系统设置", href: "/admin/system", permission: "system.read" },
  { label: "审计日志", href: "/admin/audit", permission: "audit.read" },
] as const;

export default function AdminNavigation({
  identity,
}: {
  identity: { name: string; roles: string[]; permissions: string[] };
}) {
  const pathname = usePathname();
  const visibleResources = resources.filter((resource) =>
    identity.permissions.includes(resource.permission),
  );

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.assign("/admin/login");
  }

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-bg-surface px-5 py-6 lg:flex lg:flex-col">
        <Link
          href="/admin"
          className="inline-flex w-fit items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="INK OPS 控制台首页"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-text-primary font-mono text-sm font-semibold tracking-[-0.08em] text-bg-surface">
            INK
          </span>
          <span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.28em] text-text-tertiary">
              Control plane
            </span>
            <span className="block text-sm font-semibold text-text-primary">
              Operations
            </span>
          </span>
        </Link>

        <nav className="mt-10" aria-label="管理后台主导航">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
            Control plane
          </p>
          <div className="mt-3 space-y-1">
            {visibleResources.map((resource) => {
              const active =
                resource.href === "/admin"
                  ? pathname === resource.href
                  : pathname.startsWith(resource.href);
              return (
                <Link
                  key={resource.href}
                  href={resource.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-accent-light text-accent"
                      : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
                  }`}
                >
                  <span>{resource.label}</span>
                  {active ? (
                    <span
                      className="h-2 w-2 rounded-full bg-success"
                      aria-hidden="true"
                    />
                  ) : null}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="mt-auto border-t border-border pt-5">
          <p className="truncate text-xs font-semibold text-text-primary">
            {identity.name}
          </p>
          <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-wider text-text-tertiary">
            {identity.roles.join(" · ")}
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-4 min-h-10 text-xs font-semibold text-accent"
          >
            退出管理后台
          </button>
        </div>
      </aside>

      <header className="border-b border-border bg-bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <Link href="/admin" className="flex items-center gap-2" aria-label="INK OPS 控制台首页">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-text-primary font-mono text-xs font-semibold tracking-[-0.08em] text-bg-surface">
              INK
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-text-secondary">
              / OPS
            </span>
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary"
          >
            退出
          </button>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto" aria-label="移动端管理后台导航">
          {visibleResources.map((resource) => (
            <Link
              key={resource.href}
              href={resource.href}
              className="min-h-11 shrink-0 rounded-full border border-border px-4 py-3 text-xs font-semibold text-text-secondary"
            >
              {resource.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
