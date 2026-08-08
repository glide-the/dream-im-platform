"use client";

import { useCreate } from "@refinedev/core";
import { FormEvent, useState } from "react";

export default function GatewayKeyForm() {
  const create = useCreate<Record<string, unknown>>();
  const [message, setMessage] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const scopes = ["messages:create", "chat:create", "models:list"].filter((scope) => form.get(scope) === "on");
    create.mutate({ resource: "gateway-api-keys", values: { platformUserId: form.get("platformUserId"), name: form.get("name"), scopes, expiresAt: form.get("expiresAt") ? new Date(String(form.get("expiresAt"))).toISOString() : null } }, { onSuccess: (result) => { formElement.reset(); setPlaintextKey(String(result.data.plaintextKey ?? "")); setMessage("Gateway Key 已创建。明文只显示一次，请立即安全保存。"); }, onError: (error) => setMessage(error.message) });
  }

  return <section className="admin-panel p-5 sm:p-6"><div className="border-b border-border pb-5"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">One-time credential</p><h2 className="mt-2 font-display text-xl font-semibold">发放 Gateway Key</h2><p className="mt-2 text-sm leading-6 text-text-secondary">数据库只保存哈希、前缀和 Scope；创建响应中的明文关闭后无法恢复。</p></div>{plaintextKey ? <div className="mt-5 border border-warning/50 bg-accent-orange-light p-4"><p className="text-xs font-semibold text-text-primary">仅显示一次</p><code className="mt-2 block break-all text-xs">{plaintextKey}</code><button type="button" onClick={() => navigator.clipboard.writeText(plaintextKey)} className="mt-3 min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface">复制密钥</button></div> : null}<form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-text-secondary">平台用户 ID<input className="admin-field mt-2 block font-mono text-xs" name="platformUserId" required /></label><label className="text-xs font-semibold text-text-secondary">名称<input className="admin-field mt-2 block" name="name" required /></label><label className="text-xs font-semibold text-text-secondary">过期时间（可选）<input className="admin-field mt-2 block" name="expiresAt" type="datetime-local" /></label><fieldset className="border border-border p-3"><legend className="px-1 text-xs font-semibold text-text-secondary">Scopes</legend>{[["messages:create", "Claude Messages"], ["chat:create", "OpenAI Chat"], ["models:list", "模型列表"]].map(([scope, label]) => <label key={scope} className="mr-4 inline-flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" name={scope} defaultChecked />{label}</label>)}</fieldset><div className="sm:col-span-2"><button className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface">创建并显示一次</button></div></form>{message ? <p className="mt-4 text-sm text-text-secondary" role="status">{message}</p> : null}</section>;
}
