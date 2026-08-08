"use client";

import { useInvalidate, useList, usePermissions } from "@refinedev/core";
import { useEffect, useRef, useState } from "react";

function usdToMicroUsd(value: string) {
  if (!/^\d+(?:\.\d{0,6})?$/.test(value.trim())) {
    throw new Error("入账金额必须为非负 USD，且最多 6 位小数。");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
  if (micros < 1n || micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("入账金额必须大于 0 且处于安全范围内。");
  }
  return Number(micros);
}

export default function BillingAdjustmentForm() {
  const permissions = usePermissions<string[]>({});
  const users = useList<Record<string, unknown>>({
    resource: "platform-users",
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: "email", order: "asc" }],
  });
  const invalidate = useInvalidate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [platformUserId, setPlatformUserId] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const matchingUsers = users.result.data.filter((user) => {
    const needle = search.trim().toLowerCase();
    return !needle || `${user.email ?? ""} ${user.display_name ?? ""} ${user.external_user_id ?? ""}`.toLowerCase().includes(needle);
  });

  function close() {
    if ((platformUserId || amountUsd || reason) && !window.confirm("存在未提交的入账信息，确认关闭吗？")) return;
    setOpen(false);
    setError("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) {
      setError("余额调整前必须勾选不可变账本二次确认。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const amountMicrousd = usdToMicroUsd(amountUsd);
      const response = await fetch(`/api/admin/platform-users/${encodeURIComponent(platformUserId)}/account/credit`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ amountMicrousd, reason, idempotencyKey: `credit:${crypto.randomUUID()}` }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? `余额调整失败（HTTP ${response.status}）`);
      await Promise.all([
        invalidate({ resource: "billing-accounts", invalidates: ["list", "detail"] }),
        invalidate({ resource: "ledger", invalidates: ["list", "detail"] }),
      ]);
      setMessage(`已向 ${platformUserId} 入账 $${amountUsd}；账本条目与审计已写入。`);
      setPlatformUserId("");
      setAmountUsd("");
      setReason("");
      setConfirmed(false);
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "余额调整服务暂时不可用");
    } finally {
      setPending(false);
    }
  }

  if (!permissions.data?.includes("billing.adjust")) return null;

  return (
    <section className="admin-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-tertiary">Append-only balance operation</p>
          <h2 className="mt-2 font-display text-lg font-semibold">受控余额入账</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">金额以 USD 输入并精确换算为整数 micro-USD；每次操作生成幂等键和只追加账本条目。</p>
        </div>
        <button ref={triggerRef} type="button" onClick={() => { setOpen(true); setMessage(""); setError(""); }} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface">打开入账弹窗</button>
      </div>
      {message ? <p className="mt-4 border border-success/35 bg-success-light p-3 text-sm text-success" role="status">{message}</p> : null}
      {open ? (
        <dialog ref={dialogRef} className="admin-dialog admin-dialog--modal" onCancel={(event) => { event.preventDefault(); close(); }} aria-labelledby="billing-credit-title">
          <div className="admin-dialog-frame">
            <header className="admin-dialog-header">
              <div><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-tertiary">High-risk financial action</p><h2 id="billing-credit-title" className="mt-2 font-display text-2xl font-semibold">新增余额入账</h2></div>
              <button type="button" onClick={close} className="min-h-11 border border-border px-4 text-sm">关闭</button>
            </header>
            <div className="admin-dialog-body">
              <form id="billing-credit-form" className="space-y-5" onSubmit={submit}>
                <label className="block text-xs font-semibold text-text-secondary">搜索平台用户<input className="admin-field mt-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Email、显示名或源用户 ID" /></label>
                <label className="block text-xs font-semibold text-text-secondary">平台用户 *<select className="admin-field mt-2 font-mono text-xs" value={platformUserId} onChange={(event) => setPlatformUserId(event.target.value)} required disabled={users.query.isLoading}><option value="">{users.query.isLoading ? "正在加载…" : "选择平台用户"}</option>{matchingUsers.map((user) => <option key={String(user.id)} value={String(user.id)}>{String(user.email ?? user.external_user_id ?? user.id)} · {String(user.tier ?? "—")}</option>)}</select></label>
                {users.query.error ? <p className="text-sm text-danger" role="alert">用户选项加载失败：{users.query.error.message}</p> : null}
                <label className="block text-xs font-semibold text-text-secondary">入账金额（USD） *<input className="admin-field mt-2 font-mono" value={amountUsd} onChange={(event) => setAmountUsd(event.target.value)} type="number" min="0.000001" step="0.000001" placeholder="例如 25.00" required />{amountUsd ? <span className="mt-1 block font-mono text-[11px] font-normal text-text-tertiary">{(() => { try { return `${usdToMicroUsd(amountUsd)} micro-USD`; } catch { return "最多 6 位小数"; } })()}</span> : null}</label>
                <label className="block text-xs font-semibold text-text-secondary">调整原因 *<textarea className="admin-field mt-2 min-h-28" value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} placeholder="说明业务依据、工单或退款/补偿原因" required /></label>
                <label className="flex items-start gap-3 border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>我确认该操作将写入不可变账本，不能通过编辑或删除撤销。</span></label>
                {error ? <p className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</p> : null}
              </form>
            </div>
            <footer className="admin-dialog-footer"><button type="button" onClick={close} className="min-h-11 border border-border px-4 text-sm">取消</button><button type="submit" form="billing-credit-form" disabled={pending} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "入账中…" : "确认入账"}</button></footer>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
