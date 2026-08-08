"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminBootstrapForm from "./AdminBootstrapForm";
import AdminLoginForm from "./AdminLoginForm";

type EntryState = "checking" | "setup" | "login" | "unavailable";

export default function AdminAuthEntry() {
  const [state, setState] = useState<EntryState>("checking");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function checkBootstrapState() {
      setState("checking");
      setError("");
      try {
        const response = await fetch("/api/admin/auth/bootstrap", {
          method: "GET",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(
            result?.error?.message ?? "无法读取管理员初始化状态",
          );
        }
        setState(result?.data?.required === true ? "setup" : "login");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "无法读取管理员初始化状态",
        );
        setState("unavailable");
      }
    }

    void checkBootstrapState();
    return () => controller.abort();
  }, [attempt]);

  if (state === "checking") {
    return (
      <div className="py-12 text-center" role="status" aria-live="polite">
        <span className="mx-auto block h-8 w-8 animate-spin-soft rounded-full border-2 border-border border-t-accent" />
        <p className="mt-5 text-sm font-semibold text-text-primary">正在检查启动状态</p>
        <p className="mt-2 text-xs text-text-tertiary">连接 PostgreSQL 并确认管理员配置</p>
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div role="alert">
        <div className="inline-flex items-center gap-2 rounded-full bg-danger-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-danger">
          setup unavailable
        </div>
        <h2 className="mt-6 font-display text-3xl font-semibold text-text-primary">启动检查未完成</h2>
        <p className="mt-4 text-sm leading-7 text-text-secondary">{error}</p>
        <div className="mt-6 rounded-2xl border border-border bg-bg-primary p-4 font-mono text-xs leading-6 text-text-secondary">
          docker compose up -d postgres
          <br />
          pnpm db:migrate
        </div>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="mt-6 flex min-h-12 w-full items-center justify-center rounded-full bg-text-primary px-5 py-3 text-sm font-semibold text-bg-surface focus-visible:ring-4 focus-visible:ring-accent-light"
        >
          重新检查
        </button>
      </div>
    );
  }

  if (state === "setup") {
    return (
      <section aria-labelledby="admin-setup-title">
        <div className="inline-flex items-center gap-2 rounded-full bg-accent-orange-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-orange">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-orange" aria-hidden="true" />
          first-run setup
        </div>
        <h2 id="admin-setup-title" className="mt-6 font-display text-3xl font-semibold text-text-primary">
          设置首位管理员
        </h2>
        <p className="mt-4 text-sm leading-7 text-text-secondary">
          当前 PostgreSQL 尚无管理员。完成这一页后，系统会创建超级管理员、基础角色与权限，并立即建立安全 Session。
        </p>

        <ol className="mt-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-bg-primary text-[10px] font-semibold text-text-tertiary sm:text-xs">
          {[
            ["01", "确认环境"],
            ["02", "创建账号"],
            ["03", "进入控制台"],
          ].map(([step, label], index) => (
            <li
              key={step}
              className={`px-2 py-3 text-center ${index < 2 ? "border-r border-border" : ""}`}
            >
              <span className="mr-1 font-mono text-accent-orange">{step}</span>
              {label}
            </li>
          ))}
        </ol>

        <AdminBootstrapForm onAlreadyInitialized={() => setState("login")} />
      </section>
    );
  }

  return (
    <section aria-labelledby="admin-login-title">
      <div className="inline-flex items-center gap-2 rounded-full bg-success-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
        protected session
      </div>
      <h2 id="admin-login-title" className="mt-6 font-display text-3xl font-semibold text-text-primary">
        登录运营控制台
      </h2>
      <p className="mt-4 text-sm leading-7 text-text-secondary">
        管理身份、角色和权限均由服务端数据库核验。浏览器不会保存 Provider 密钥或管理 Session 明文。
      </p>
      <AdminLoginForm />
      <div className="mt-8 border-t border-border pt-6">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
          ← 返回应用首页
        </Link>
      </div>
    </section>
  );
}
