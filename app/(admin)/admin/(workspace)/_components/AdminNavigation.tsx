"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const lockedResources = ["客户", "待办", "运行设置", "审计日志"];

export default function AdminNavigation() {
  const pathname = usePathname();
  const overviewActive = pathname === "/admin";

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
            Available now
          </p>
          <Link
            href="/admin"
            aria-current={overviewActive ? "page" : undefined}
            className={`mt-3 flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-medium transition-colors ${
              overviewActive
                ? "bg-accent-light text-accent"
                : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
            }`}
          >
            <span>控制台概览</span>
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
          </Link>

          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
            Awaiting gates
          </p>
          <div className="mt-3 space-y-1">
            {lockedResources.map((resource) => (
              <div
                key={resource}
                className="flex min-h-11 items-center justify-between rounded-xl px-3 text-sm text-text-tertiary"
                aria-disabled="true"
              >
                <span>{resource}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider">
                  locked
                </span>
              </div>
            ))}
          </div>
        </nav>

        <div className="mt-auto border-t border-border pt-5">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-accent-orange" aria-hidden="true" />
            <span className="font-mono uppercase tracking-[0.12em]">internal-only</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-text-tertiary">
            身份、权限与资源 API 尚未开放。
          </p>
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
          <span className="rounded-full bg-accent-orange-light px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-orange">
            internal · S0
          </span>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto" aria-label="移动端管理后台导航">
          <Link
            href="/admin"
            aria-current={overviewActive ? "page" : undefined}
            className="min-h-11 shrink-0 rounded-full bg-accent-light px-4 py-3 text-xs font-semibold text-accent"
          >
            概览
          </Link>
          <Link
            href="/admin/login"
            className="min-h-11 shrink-0 rounded-full border border-border px-4 py-3 text-xs font-semibold text-text-secondary"
          >
            身份状态
          </Link>
        </nav>
      </header>
    </>
  );
}
