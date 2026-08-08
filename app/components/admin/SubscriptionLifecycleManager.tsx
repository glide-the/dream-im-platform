"use client";

import { useList } from "@refinedev/core";
import { useMemo, useState, type FormEvent } from "react";

type Row = Record<string, unknown> & { id: string };
type Action = "renew" | "upgrade" | "downgrade" | "pause" | "resume" | "cancel";

function requestKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export default function SubscriptionLifecycleManager() {
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [action, setAction] = useState<Action>("renew");
  const [targetVersion, setTargetVersion] = useState("");
  const [reason, setReason] = useState("");
  const [userId, setUserId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [trial, setTrial] = useState(false);

  const subscriptions = useList<Row>({ resource: "subscriptions", pagination: { currentPage: page, pageSize: 20 }, sorters: [{ field: "updated_at", order: "desc" }] });
  const users = useList<Row>({ resource: "platform-users", pagination: { currentPage: 1, pageSize: 100 }, filters: [{ field: "status", operator: "eq", value: "active" }] });
  const versions = useList<Row>({ resource: "subscription-plan-versions", pagination: { currentPage: 1, pageSize: 100 }, filters: [{ field: "status", operator: "eq", value: "published" }] });
  const rows = subscriptions.result.data ?? [];
  const total = subscriptions.result.total ?? 0;
  const published = useMemo(() => versions.result.data ?? [], [versions.result.data]);

  async function post(url: string, body: Record<string, unknown>) {
    setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `操作失败（HTTP ${response.status}）`);
      setMessage("订阅操作已提交并写入事件与审计记录。");
      await subscriptions.query.refetch();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "订阅操作失败");
      return false;
    } finally { setPending(false); }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    const ok = await post("/api/admin/subscriptions", { platformUserId: userId, planVersionId: versionId, startInTrial: trial, idempotencyKey: requestKey("activate"), reason: "Admin subscription activation" });
    if (ok) { setUserId(""); setVersionId(""); setTrial(false); }
  }

  async function transition(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const body: Record<string, unknown> = { idempotencyKey: requestKey(action), reason };
    if (["upgrade", "downgrade"].includes(action)) body.planVersionId = targetVersion;
    const ok = await post(`/api/admin/subscriptions/${encodeURIComponent(selected.id)}/${action}`, body);
    if (ok) { setSelected(null); setReason(""); setTargetVersion(""); }
  }

  return <div className="space-y-6">
    {message ? <p className="border border-success/35 bg-success-light p-4 text-sm text-success" role="status">{message}</p> : null}
    {error ? <p className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</p> : null}
    <form onSubmit={activate} className="admin-panel grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
      <label className="text-xs font-semibold text-text-secondary">计费用户<select className="admin-field mt-2" required value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">选择用户</option>{(users.result.data ?? []).map((user) => <option key={user.id} value={user.id}>{String(user.email ?? user.display_name ?? user.id)}</option>)}</select></label>
      <label className="text-xs font-semibold text-text-secondary">已发布版本<select className="admin-field mt-2" required value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">选择版本</option>{published.map((version) => <option key={version.id} value={version.id}>{String(version.plan_code)} · v{String(version.version_number)}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={trial} onChange={(event) => setTrial(event.target.checked)} /> 从试用开始</label>
      <button disabled={pending} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">开通订阅</button>
    </form>
    <section className="admin-panel overflow-hidden" aria-label="用户订阅清单">
      <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="border-b border-border bg-bg-secondary font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary"><tr>{["用户","套餐","状态","当前周期","Token 额度","金额额度","超额策略","操作"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((row) => {
        const tokensLeft = Number(row.granted_tokens ?? 0) - Number(row.reserved_tokens ?? 0) - Number(row.consumed_tokens ?? 0);
        const moneyLeft = Number(row.granted_microusd ?? 0) - Number(row.reserved_microusd ?? 0) - Number(row.consumed_microusd ?? 0);
        return <tr key={row.id}><td className="px-4 py-3"><span className="font-semibold">{String(row.email ?? row.platform_user_id)}</span><span className="block font-mono text-[10px] text-text-tertiary">{row.id}</span></td><td className="px-4 py-3">{String(row.plan_code)} · v{String(row.version_number)}</td><td className="px-4 py-3"><span className="admin-status">{String(row.status)}</span></td><td className="px-4 py-3 text-xs">{new Date(String(row.current_period_start)).toLocaleDateString()} → {new Date(String(row.current_period_end)).toLocaleDateString()}</td><td className="px-4 py-3 font-mono">{tokensLeft.toLocaleString()}</td><td className="px-4 py-3 font-mono">${(moneyLeft / 1_000_000).toFixed(2)}</td><td className="px-4 py-3">{String(row.overage_policy ?? "见版本")}</td><td className="px-4 py-3"><button type="button" className="min-h-10 underline" onClick={() => { setSelected(row); setAction("renew"); setError(""); }}>管理</button></td></tr>;
      })}{!subscriptions.query.isLoading && rows.length === 0 ? <tr><td colSpan={8} className="px-5 py-14 text-center text-text-tertiary">尚无用户订阅。请先发布含权益的套餐版本。</td></tr> : null}</tbody></table></div>
      <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-xs"><span>共 {total} 条 · 第 {page} 页</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="min-h-10 border border-border px-3 disabled:opacity-40">上一页</button><button type="button" disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)} className="min-h-10 border border-border px-3 disabled:opacity-40">下一页</button></div></footer>
    </section>
    {selected ? <div className="fixed inset-0 z-50 grid place-items-end bg-black/35 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="subscription-action-title"><form onSubmit={transition} className="w-full max-w-xl bg-bg-surface p-6 shadow-medium"><h2 id="subscription-action-title" className="font-display text-2xl font-semibold">管理用户订阅</h2><p className="mt-2 break-all font-mono text-[10px] text-text-tertiary">{selected.id}</p><label className="mt-5 block text-xs font-semibold text-text-secondary">操作<select className="admin-field mt-2" value={action} onChange={(event) => setAction(event.target.value as Action)}>{(["renew","upgrade","downgrade","pause","resume","cancel"] as Action[]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{["upgrade", "downgrade"].includes(action) ? <label className="mt-4 block text-xs font-semibold text-text-secondary">目标已发布版本<select required className="admin-field mt-2" value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)}><option value="">选择目标版本</option>{published.map((version) => <option key={version.id} value={version.id}>{String(version.plan_code)} · v{String(version.version_number)}</option>)}</select></label> : null}<label className="mt-4 block text-xs font-semibold text-text-secondary">操作原因 *<textarea required minLength={3} maxLength={500} className="admin-field mt-2 min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="mt-6 flex justify-end gap-3"><button type="button" className="min-h-11 border border-border px-4" onClick={() => setSelected(null)}>取消</button><button disabled={pending} className={`min-h-11 px-5 font-semibold text-white ${action === "cancel" ? "bg-danger" : "bg-text-primary"}`}>确认执行</button></div></form></div> : null}
  </div>;
}
