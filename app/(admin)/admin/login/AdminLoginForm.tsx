"use client";

import { useState } from "react";

export default function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result?.error?.message ?? "登录失败，请检查配置或凭据");
        return;
      }
      window.location.assign("/admin");
    } catch {
      setError("管理认证服务暂时不可用");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={submit}>
      <label className="block">
        <span className="text-xs font-semibold text-text-secondary">管理员邮箱</span>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 min-h-12 w-full rounded-xl border border-border bg-bg-primary px-4 text-sm outline-none transition focus:border-accent"
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-text-secondary">密码</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 min-h-12 w-full rounded-xl border border-border bg-bg-primary px-4 text-sm outline-none transition focus:border-accent"
        />
      </label>
      {error ? (
        <p role="alert" className="rounded-xl bg-danger-light px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-12 w-full items-center justify-center rounded-full bg-text-primary px-5 py-3 text-sm font-semibold text-bg-surface disabled:opacity-60"
      >
        {submitting ? "验证中…" : "登录控制台"}
      </button>
    </form>
  );
}
