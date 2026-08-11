"use client";

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
        <span className="mx-auto block h-8 w-8 animate-spin rounded-full bg-accent-light p-2">
          <span className="block h-full w-full rounded-full bg-accent" />
        </span>
        <p className="mt-5 text-sm font-semibold text-text-primary">正在检查启动状态</p>
        <p className="mt-2 text-xs text-text-tertiary">连接 PostgreSQL 并确认管理员配置</p>
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div role="alert">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-danger">Setup unavailable</p>
        <h2 className="mt-4 font-display text-3xl font-semibold text-text-primary">启动检查未完成</h2>
        <p className="mt-4 text-sm leading-7 text-text-secondary">{error}</p>
        <div className="mt-6 rounded-2xl bg-bg-primary p-4 font-mono text-xs leading-6 text-text-secondary">
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
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">First-run setup</p>
        <h2 id="admin-setup-title" className="mt-4 font-display text-3xl font-semibold text-text-primary">
          设置首位管理员
        </h2>
        <p className="mt-4 text-sm leading-7 text-text-secondary">
          创建唯一的超级管理员账号，完成后即可进入控制台。
        </p>
        <AdminBootstrapForm onAlreadyInitialized={() => setState("login")} />
      </section>
    );
  }

  return (
    <section aria-labelledby="admin-login-title">
      <h2 id="admin-login-title" className="font-display text-4xl font-semibold tracking-[-0.03em] text-text-primary">
        登录运营控制台
      </h2>
      <AdminLoginForm />
    </section>
  );
}
