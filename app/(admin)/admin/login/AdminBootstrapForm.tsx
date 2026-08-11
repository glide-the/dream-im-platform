"use client";

import { useState } from "react";

const MIN_PASSWORD_LENGTH = 14;

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl bg-bg-primary px-4 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:bg-accent-light focus:ring-2 focus:ring-accent/20";

export default function AdminBootstrapForm({
  onAlreadyInitialized,
}: {
  onAlreadyInitialized: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/auth/bootstrap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-bootstrap-token": bootstrapToken,
        },
        body: JSON.stringify({ email, displayName, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result?.error?.code === "ADMIN_ALREADY_BOOTSTRAPPED") {
          setError("管理员已经完成初始化，正在切换到登录入口。");
          onAlreadyInitialized();
          return;
        }
        setError(result?.error?.message ?? "首次设置失败，请检查启动密钥和数据库状态");
        return;
      }
      window.location.assign("/admin");
    } catch {
      setError("首次设置服务暂时不可用，请确认 PostgreSQL 已启动并完成迁移");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-text-secondary">显示名称</span>
          <input
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-text-secondary">管理员邮箱</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-text-secondary">
          <label htmlFor="admin-bootstrap-password">初始密码</label>
          <button
            type="button"
            className="min-h-8 rounded-lg px-2 text-accent transition hover:bg-accent-light focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? "隐藏" : "显示"}
          </button>
        </div>
        <input
          id="admin-bootstrap-password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
          aria-describedby="initial-password-note"
        />
      </div>
      <p id="initial-password-note" className="rounded-xl bg-accent-orange-light px-4 py-3 text-xs leading-5 text-text-secondary">
        使用至少 14 个字符的独立密码；页面没有开发默认账号或默认密码。
      </p>

      <label className="block">
        <span className="text-xs font-semibold text-text-secondary">首次启动密钥</span>
        <input
          type="password"
          autoComplete="off"
          required
          value={bootstrapToken}
          onChange={(event) => setBootstrapToken(event.target.value)}
          className={inputClass}
          placeholder="粘贴 ADMIN_BOOTSTRAP_TOKEN"
          aria-describedby="bootstrap-token-note"
        />
      </label>
      <p id="bootstrap-token-note" className="text-xs leading-5 text-text-tertiary">
        密钥由 <code className="font-mono text-text-secondary">pnpm env:setup</code> 自动生成，保存在本机
        <code className="ml-1 font-mono text-text-secondary">.env.local</code>；页面不会读取或回显该值。
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-danger-light px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-12 w-full items-center justify-center rounded-full bg-text-primary px-5 py-3 text-sm font-semibold text-bg-surface transition hover:-translate-y-0.5 hover:shadow-medium focus-visible:ring-4 focus-visible:ring-accent-light disabled:translate-y-0 disabled:cursor-wait disabled:opacity-60"
      >
        {submitting ? "正在创建并登录…" : "创建管理员并进入控制台"}
      </button>
    </form>
  );
}
