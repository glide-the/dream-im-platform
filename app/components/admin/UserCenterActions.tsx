"use client";

import { useCreate } from "@refinedev/core";
import { useState } from "react";

const inputClass =
  "min-h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-sm outline-none focus:border-accent";

export default function UserCenterActions() {
  const user = useCreate();
  const apiKey = useCreate<Record<string, unknown>>();
  const [message, setMessage] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");

  function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    user.mutate(
      {
        resource: "platform-users",
        values: {
          source: form.get("source"),
          externalUserId: form.get("externalUserId"),
          email: form.get("email") || null,
          displayName: form.get("displayName") || null,
          tier: form.get("tier"),
          status: "active",
          dailyTokenLimit: Number(form.get("dailyTokenLimit")) || null,
          monthlyTokenLimit: Number(form.get("monthlyTokenLimit")) || null,
          metadata: {},
        },
      },
      {
        onSuccess: () => {
          formElement.reset();
          setMessage("平台计费用户和空账户已创建。");
        },
        onError: (error) => setMessage(error.message),
      },
    );
  }

  function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const scopes = ["messages:create", "chat:create", "models:list"].filter(
      (scope) => form.get(scope) === "on",
    );
    apiKey.mutate(
      {
        resource: "gateway-api-keys",
        values: {
          platformUserId: form.get("platformUserId"),
          name: form.get("name"),
          scopes,
          expiresAt: null,
        },
      },
      {
        onSuccess: (result) => {
          formElement.reset();
          setPlaintextKey(String(result.data.plaintextKey ?? ""));
          setMessage("Gateway Key 已创建。请立即复制，关闭后无法恢复。");
        },
        onError: (error) => setMessage(error.message),
      },
    );
  }

  async function creditAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get("confirmed") !== "on") {
      setMessage("余额调整前必须勾选二次确认。");
      return;
    }
    const platformUserId = String(form.get("platformUserId"));
    const response = await fetch(
      `/api/admin/platform-users/${encodeURIComponent(platformUserId)}/account/credit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountMicrousd: Number(form.get("amountMicrousd")),
          reason: form.get("reason"),
          idempotencyKey: `credit:${crypto.randomUUID()}`,
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setMessage(result?.error?.message ?? "余额调整失败");
      return;
    }
    formElement.reset();
    setMessage("余额已通过不可变账本入账。");
  }

  return (
    <section className="rounded-[24px] border border-border bg-bg-surface p-5 shadow-subtle sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            identity · keys · balance
          </p>
          <h2 className="mt-2 text-lg font-semibold">用户运营动作</h2>
        </div>
        {message ? <p className="max-w-xl text-sm text-text-secondary">{message}</p> : null}
      </div>
      {plaintextKey ? (
        <div className="mt-5 rounded-2xl border border-accent-orange bg-accent-orange-light p-4">
          <p className="text-xs font-semibold text-accent-orange">仅显示一次的 Gateway API Key</p>
          <code className="mt-2 block break-all text-xs text-text-primary">{plaintextKey}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(plaintextKey)}
            className="mt-3 min-h-10 rounded-full bg-text-primary px-4 text-xs font-semibold text-bg-surface"
          >
            复制密钥
          </button>
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <details className="rounded-2xl border border-border p-4" open>
          <summary className="cursor-pointer font-semibold">新增平台用户</summary>
          <form className="mt-4 space-y-3" onSubmit={createUser}>
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="source" defaultValue="ink-dream" required /><input className={inputClass} name="externalUserId" placeholder="Story User ID" required /></div>
            <input className={inputClass} name="email" type="email" placeholder="Email（可选）" />
            <input className={inputClass} name="displayName" placeholder="显示名（可选）" />
            <input className={inputClass} name="tier" defaultValue="free" required />
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="dailyTokenLimit" type="number" placeholder="每日 Token" /><input className={inputClass} name="monthlyTokenLimit" type="number" placeholder="每月 Token" /></div>
            <button className="min-h-11 w-full rounded-full bg-text-primary text-sm font-semibold text-bg-surface">创建用户</button>
          </form>
        </details>
        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer font-semibold">发放 Gateway Key</summary>
          <form className="mt-4 space-y-3" onSubmit={createKey}>
            <input className={inputClass} name="platformUserId" placeholder="Platform User ID" required />
            <input className={inputClass} name="name" placeholder="story-workspace-prod" required />
            {[
              ["messages:create", "Claude Messages"],
              ["chat:create", "OpenAI Chat"],
              ["models:list", "模型列表"],
            ].map(([scope, label]) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" name={scope} defaultChecked /> {label}
              </label>
            ))}
            <button className="min-h-11 w-full rounded-full bg-text-primary text-sm font-semibold text-bg-surface">创建并显示一次</button>
          </form>
        </details>
        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer font-semibold">余额入账</summary>
          <form className="mt-4 space-y-3" onSubmit={creditAccount}>
            <input className={inputClass} name="platformUserId" placeholder="Platform User ID" required />
            <input className={inputClass} name="amountMicrousd" type="number" min="1" placeholder="金额（micro-USD）" required />
            <textarea className={`${inputClass} min-h-24 py-3`} name="reason" placeholder="调整原因（至少 8 字）" required />
            <label className="flex items-start gap-2 text-sm text-text-secondary"><input className="mt-1" type="checkbox" name="confirmed" /> 我确认该操作将写入不可变账本</label>
            <button className="min-h-11 w-full rounded-full bg-text-primary text-sm font-semibold text-bg-surface">确认入账</button>
          </form>
        </details>
      </div>
    </section>
  );
}
