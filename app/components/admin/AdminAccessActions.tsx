"use client";

import { useCan, useCreate } from "@refinedev/core";
import { useState } from "react";

const inputClass =
  "min-h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-sm outline-none focus:border-accent";

export default function AdminAccessActions() {
  const create = useCreate();
  const access = useCan({ resource: "admin-users", action: "create" });
  const [message, setMessage] = useState("");

  if (!access.data?.can) return null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const roleCodes = ["super_admin", "operator", "auditor"].filter(
      (role) => form.get(role) === "on",
    );
    create.mutate(
      {
        resource: "admin-users",
        values: {
          email: form.get("email"),
          displayName: form.get("displayName") || null,
          password: form.get("password"),
          roleCodes,
        },
      },
      {
        onSuccess: () => {
          formElement.reset();
          setMessage("管理员已创建并分配角色。密码不会在后台回显。");
        },
        onError: (error) => setMessage(error.message),
      },
    );
  }

  return (
    <details className="rounded-[24px] border border-border bg-bg-surface p-5 shadow-subtle sm:p-6">
      <summary className="cursor-pointer text-base font-semibold">新增管理员</summary>
      <form className="mt-5 grid gap-3 lg:grid-cols-2" onSubmit={submit}>
        <input className={inputClass} name="email" type="email" placeholder="ops@example.com" required />
        <input className={inputClass} name="displayName" placeholder="显示名（可选）" />
        <input className={inputClass} name="password" type="password" minLength={14} autoComplete="new-password" placeholder="初始密码（至少 14 字符）" required />
        <fieldset className="rounded-xl border border-border px-3 py-2">
          <legend className="px-1 text-xs text-text-tertiary">角色（至少一个）</legend>
          <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
            {[
              ["operator", "运营"],
              ["auditor", "审计"],
              ["super_admin", "超级管理员"],
            ].map(([code, label], index) => (
              <label key={code} className="flex items-center gap-2">
                <input type="checkbox" name={code} defaultChecked={index === 0} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        <button className="min-h-11 rounded-full bg-text-primary px-5 text-sm font-semibold text-bg-surface lg:col-span-2">
          创建管理员
        </button>
      </form>
      {message ? <p role="status" className="mt-4 text-sm text-text-secondary">{message}</p> : null}
    </details>
  );
}
