"use client";

import { FormEvent, useState } from "react";

export default function BillingAdjustmentForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get("confirmed") !== "on") {
      setMessage("余额调整前必须勾选二次确认。");
      return;
    }
    setPending(true);
    const platformUserId = String(form.get("platformUserId"));
    const response = await fetch(`/api/admin/platform-users/${encodeURIComponent(platformUserId)}/account/credit`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ amountMicrousd: Number(form.get("amountMicrousd")), reason: form.get("reason"), idempotencyKey: `credit:${crypto.randomUUID()}` }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(result?.error?.message ?? "余额调整失败");
      return;
    }
    formElement.reset();
    setMessage("余额已通过只追加账本入账；刷新列表可核对余额与流水。");
  }

  return <details className="admin-panel p-5 sm:p-6"><summary className="cursor-pointer font-display text-lg font-semibold">受控余额入账</summary><p className="mt-2 text-sm leading-6 text-text-secondary">金额使用整数 micro-USD；每次调整生成独立幂等键和账本条目，不覆盖既有余额历史。</p><form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-text-secondary">Platform User ID<input className="admin-field mt-2 block font-mono text-xs" name="platformUserId" required /></label><label className="text-xs font-semibold text-text-secondary">入账金额（micro-USD）<input className="admin-field mt-2 block" name="amountMicrousd" type="number" min="1" required /></label><label className="text-xs font-semibold text-text-secondary sm:col-span-2">调整原因<textarea className="admin-field mt-2 block min-h-24" name="reason" minLength={8} maxLength={500} required /></label><label className="flex items-start gap-3 border border-warning/40 bg-accent-orange-light p-4 text-sm sm:col-span-2"><input className="mt-1" type="checkbox" name="confirmed" />我确认该操作将写入不可变账本，不能通过编辑或删除撤销。</label><div className="sm:col-span-2"><button disabled={pending} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "入账中…" : "确认入账"}</button></div></form>{message ? <p className="mt-4 text-sm text-text-secondary" role="status">{message}</p> : null}</details>;
}
