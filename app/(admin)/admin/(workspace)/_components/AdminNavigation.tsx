// [Input] Current protected Admin path, theme state, and permission-filtered navigation descriptors.
// [Output] Accessible Admin workspace navigation including global ClaudePlugin Marketplace operations.
// [Pos] Admin chrome; resource authorization remains server-owned.
// [Sync] 2026-08-19: add the Remote Marketplace resource entry under operations.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "dashboard-theme";
const THEME_CHANGE_EVENT = "ink-memory-theme-change";

function readTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: ThemeMode, mode: ThemeMode | "system" = theme) {
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function subscribeToTheme(onChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const mode = event.newValue === "light" || event.newValue === "dark"
      ? event.newValue
      : "system";
    const resolved = mode === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    applyTheme(resolved, mode);
    onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => "light");
  const isDark = theme === "dark";
  const nextTheme: ThemeMode = isDark ? "light" : "dark";

  function toggleTheme() {
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for this page when storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`切换至${isDark ? "浅色" : "深色"}主题`}
      aria-pressed={isDark}
      className="mt-4 flex min-h-10 w-full items-center justify-between text-xs font-semibold text-[var(--color-admin-nav-muted)] transition-colors hover:text-[var(--color-admin-nav-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
    >
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="font-mono text-[11px] text-[var(--color-admin-nav-muted)]">
          {isDark ? "●" : "○"}
        </span>
        主题
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-admin-nav-muted)]">
        {isDark ? "深色" : "浅色"}
      </span>
    </button>
  );
}

type NavItem = {
  label: string;
  href: string;
  permission: string;
  mark: string;
};

const dashboard: NavItem = {
  label: "运营总览",
  href: "/admin",
  permission: "dashboard.read",
  mark: "OV",
};

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "剧本数据",
    items: [
      { label: "工作区", href: "/admin/story/workspaces", permission: "story.read", mark: "WS" },
      { label: "剧本", href: "/admin/story/stories", permission: "story.read", mark: "ST" },
    ],
  },
  {
    label: "AI 模型中心",
    items: [
      { label: "Provider", href: "/admin/models/providers", permission: "providers.read", mark: "PV" },
      { label: "Models", href: "/admin/models/models", permission: "models.read", mark: "MD" },
      { label: "Pricing", href: "/admin/models/pricing", permission: "pricing.read", mark: "PR" },
    ],
  },
  {
    label: "订阅中心",
    items: [
      { label: "套餐", href: "/admin/subscriptions/plans", permission: "subscriptions.read", mark: "PL" },
      { label: "版本", href: "/admin/subscriptions/versions", permission: "subscriptions.read", mark: "VR" },
      { label: "权益", href: "/admin/subscriptions/entitlements", permission: "subscriptions.read", mark: "EN" },
      { label: "用户订阅", href: "/admin/subscriptions/users", permission: "subscriptions.read", mark: "SB" },
      { label: "Token 流水", href: "/admin/subscriptions/token-ledger", permission: "subscriptions.read", mark: "TL" },
    ],
  },
  {
    label: "Token 计费",
    items: [
      { label: "使用记录", href: "/admin/billing/usage", permission: "billing.read", mark: "US" },
      { label: "账户余额", href: "/admin/billing/accounts", permission: "billing.read", mark: "AC" },
      { label: "交易账本", href: "/admin/billing/ledger", permission: "billing.read", mark: "LD" },
      { label: "计费报表", href: "/admin/billing/reports", permission: "billing.read", mark: "RP" },
    ],
  },
  {
    label: "代理网关",
    items: [
      { label: "请求日志", href: "/admin/gateway/requests", permission: "gateway.read", mark: "RQ" },
      { label: "Gateway Key", href: "/admin/gateway/keys", permission: "gateway.read", mark: "KY" },
      { label: "限流策略", href: "/admin/gateway/rate-limits", permission: "gateway.read", mark: "RL" },
    ],
  },
  {
    label: "用户中心",
    items: [
      { label: "平台用户", href: "/admin/resources/users", permission: "users.read", mark: "UR" },
    ],
  },
  {
    label: "权限管理",
    items: [
      { label: "管理员", href: "/admin/access/admins", permission: "access.read", mark: "AD" },
      { label: "角色", href: "/admin/access/roles", permission: "access.read", mark: "RO" },
      { label: "权限", href: "/admin/access/permissions", permission: "access.read", mark: "PM" },
    ],
  },
  {
    label: "资源管理",
    items: [
      { label: "文件存储", href: "/admin/resources/storage", permission: "storage.read", mark: "FS" },
      { label: "插件市场", href: "/admin/resources/claude-plugin-marketplaces", permission: "claude_plugin_marketplaces.manage", mark: "MP" },
    ],
  },
  {
    label: "系统治理",
    items: [
      { label: "审计日志", href: "/admin/system/audit", permission: "audit.read", mark: "AU" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

function NavContent({
  identity,
  pathname,
  close,
}: {
  identity: { name: string; roles: string[]; permissions: string[] };
  pathname: string;
  close?: () => void;
}) {
  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.assign("/admin/login");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-7 pb-12 pt-9">
        <Link href="/admin" onClick={close} className="flex min-w-0 items-start gap-4" aria-label="Ink Memory 运营控制台首页">
          <span className="pt-1 font-mono text-[10px] font-semibold tracking-[0.12em] text-[var(--color-admin-nav-active-text)]">INK</span>
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-semibold text-[var(--color-admin-nav-text)]">Ink Memory</span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-admin-nav-muted)]">Operations console</span>
          </span>
        </Link>
        {close ? <button type="button" onClick={close} className="min-h-11 px-2 text-sm text-[var(--color-admin-nav-muted)] hover:text-[var(--color-admin-nav-text)]" aria-label="关闭导航">关闭</button> : null}
      </div>

      <nav className="admin-nav-scroll min-h-0 flex-1 overflow-y-auto px-7 pb-10" aria-label="管理后台主导航">
        {identity.permissions.includes(dashboard.permission) ? (
          <Link
            href={dashboard.href}
            onClick={close}
            aria-current={isActive(pathname, dashboard.href) ? "page" : undefined}
            className={`mb-9 flex min-h-10 items-center gap-3 text-sm transition-all ${isActive(pathname, dashboard.href) ? "translate-x-1 font-semibold text-[var(--color-admin-nav-active-text)]" : "text-[var(--color-admin-nav-text)] hover:translate-x-1 hover:text-[var(--color-admin-nav-hover)]"}`}
          >
            <span className={`w-5 font-mono text-[9px] ${isActive(pathname, dashboard.href) ? "text-[var(--color-admin-nav-active-muted)]" : "text-[var(--color-admin-nav-muted)]"}`}>{dashboard.mark}</span>
            {dashboard.label}
          </Link>
        ) : null}

        {groups.map((group) => {
          const items = group.items.filter((item) => identity.permissions.includes(item.permission));
          if (!items.length) return null;
          return (
            <section key={group.label} className="mb-9">
              <h2 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-admin-nav-muted)]">{group.label}</h2>
              <div className="mt-3 space-y-1">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-9 items-center gap-3 text-sm transition-all ${active ? "translate-x-1 font-semibold text-[var(--color-admin-nav-active-text)]" : "text-[var(--color-admin-nav-text)] hover:translate-x-1 hover:text-[var(--color-admin-nav-hover)]"}`}
                    >
                      <span className={`w-5 font-mono text-[9px] ${active ? "text-[var(--color-admin-nav-active-muted)]" : "text-[var(--color-admin-nav-muted)]"}`}>{item.mark}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>

      <div className="px-7 pb-7 pt-5">
        <p className="truncate text-xs font-semibold text-[var(--color-admin-nav-text)]">{identity.name}</p>
        <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-admin-nav-muted)]">{identity.roles.join(" · ")}</p>
        <ThemeToggle />
        <button type="button" onClick={logout} className="mt-2 min-h-10 text-xs font-semibold text-[var(--color-admin-nav-muted)] hover:text-[var(--color-admin-nav-text)]">退出管理后台</button>
      </div>
    </div>
  );
}

export default function AdminNavigation({
  identity,
}: {
  identity: { name: string; roles: string[]; permissions: string[] };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] bg-[var(--color-admin-nav-bg)] lg:block">
        <NavContent identity={identity} pathname={pathname} />
      </aside>

      <header className="sticky top-0 z-20 flex h-20 items-center justify-between bg-bg-primary px-5 lg:hidden">
        <Link href="/admin" className="flex items-center gap-3" aria-label="Ink Memory 运营控制台首页">
          <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-accent">INK</span>
          <span className="font-display text-sm font-semibold">运营控制台</span>
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-1 text-sm font-semibold" aria-expanded={open} aria-controls="admin-mobile-nav">菜单</button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="管理后台导航">
          <button type="button" className="absolute inset-0 bg-black/35" onClick={() => setOpen(false)} aria-label="关闭导航遮罩" />
          <aside id="admin-mobile-nav" className="absolute inset-y-0 left-0 w-[min(88vw,340px)] bg-[var(--color-admin-nav-bg)] shadow-medium">
            <NavContent identity={identity} pathname={pathname} close={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
