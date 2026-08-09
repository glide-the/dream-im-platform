"use client";

import { useCan, useList } from "@refinedev/core";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type Row = Record<string, unknown> & { id: string };
type Action =
  | "renew"
  | "upgrade"
  | "downgrade"
  | "pause"
  | "resume"
  | "cancel"
  | "revoke_cancel"
  | "grant_tokens";

const actionOptions: Array<{
  value: Action;
  label: string;
  description: string;
}> = [
  {
    value: "grant_tokens",
    label: "补发本周期 Token",
    description: "把免费 Token 追加到当前个人订阅周期，立即参与 Gateway 预授权；操作不会修改每日/每月安全限流，也不会在下周期重复发放。",
  },
  {
    value: "renew",
    label: "续期",
    description: "只能在当前个人周期结束后续期；提前提交会由服务端以 409 拒绝，不会提前发放下周期 Token。",
  },
  {
    value: "upgrade",
    label: "升级套餐",
    description: "只创建待生效版本，在下一个个人周期边界切换；当前周期不重置，也不补发 Token。",
  },
  {
    value: "downgrade",
    label: "降级套餐",
    description: "只创建待生效版本，在下一个个人周期边界切换；当前周期额度保持不变。",
  },
  {
    value: "pause",
    label: "暂停",
    description: "暂停新的 Gateway 调用，不改写已经发生的 Token Usage 与当前周期事实。",
  },
  {
    value: "resume",
    label: "恢复",
    description: "恢复当前订阅资格；不会因恢复而重置周期或再次发放 Token。",
  },
  {
    value: "cancel",
    label: "期末取消",
    description: "当前周期仍可使用，到个人周期边界后进入已取消；不会再发放下周期 Token。",
  },
  {
    value: "revoke_cancel",
    label: "撤销期末取消",
    description: "仅在当前周期结束前清除期末取消标记；不移动周期，也不重新发放 Token。",
  },
];

function requestKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function tokenValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatToken(value: unknown) {
  return tokenValue(value).toLocaleString("zh-CN");
}

function formatDate(value: unknown) {
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
}

function userLabel(user: Row) {
  const email = String(user.email ?? "").trim();
  const name = String(user.display_name ?? "").trim();
  if (email && name) return `${email} · ${name}`;
  return email || name || user.id;
}

function userSelectionState(user: Row) {
  const projected =
    user.projection_ready === true || String(user.projection_ready) === "true";
  if (!projected) return { selectable: false, suffix: "兼容投影缺失" };
  if (user.status !== "active") {
    return { selectable: false, suffix: `调用状态 ${String(user.status ?? "unknown")}` };
  }
  return { selectable: true, suffix: "" };
}

function pendingVersionLabel(row: Row) {
  if (!row.pending_plan_version_id) return "—";
  if (row.pending_version_number) {
    return `${String(row.pending_plan_code ?? "待生效版本")} · v${String(row.pending_version_number)}`;
  }
  return String(row.pending_plan_version_id);
}

export default function SubscriptionLifecycleManager() {
  const searchParams = useSearchParams();
  const grantIntent = searchParams.get("intent") === "grant";
  const [page, setPage] = useState(1);
  const [subscriptionSearch, setSubscriptionSearch] = useState(
    () => searchParams.get("email")?.trim() ?? "",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [action, setAction] = useState<Action>("renew");
  const [targetVersion, setTargetVersion] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [reason, setReason] = useState("");
  const [userId, setUserId] = useState("");
  const [selectedUserLabel, setSelectedUserLabel] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [versionId, setVersionId] = useState("");
  const [trial, setTrial] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const manageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const grantAccess = useCan({
    resource: "subscription-token-grants",
    action: "create",
  });

  const subscriptions = useList<Row>({
    resource: "subscriptions",
    pagination: { currentPage: page, pageSize: 20 },
    sorters: [{ field: "updated_at", order: "desc" }],
    filters: subscriptionSearch.trim()
      ? [{ field: "email", operator: "contains", value: subscriptionSearch.trim() }]
      : [],
  });
  const users = useList<Row>({
    resource: "platform-users",
    pagination: { currentPage: userPage, pageSize: 50 },
    sorters: [{ field: "email", order: "asc" }],
    filters: userSearch.trim()
      ? [{ field: "email", operator: "contains", value: userSearch.trim() }]
      : [],
  });
  const versions = useList<Row>({
    resource: "subscription-plan-versions",
    pagination: { currentPage: 1, pageSize: 100 },
    filters: [{ field: "status", operator: "eq", value: "published" }],
  });
  const rows = subscriptions.result.data ?? [];
  const total = subscriptions.result.total ?? 0;
  const userTotal = users.result.total ?? 0;
  const userPages = Math.max(1, Math.ceil(userTotal / 50));
  const published = useMemo(() => versions.result.data ?? [], [versions.result.data]);
  const visibleActionOptions = actionOptions.filter(
    (option) => option.value !== "grant_tokens" || grantAccess.data?.can,
  );
  const activeAction = actionOptions.find((option) => option.value === action)!;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => {
        dialog.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
      });
    } else if (!selected && dialog.open) {
      dialog.close();
      requestAnimationFrame(() => manageTriggerRef.current?.focus());
    }
  }, [selected]);

  async function post(url: string, body: Record<string, unknown>) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `操作失败（HTTP ${response.status}）`);
      }
      setMessage("订阅操作已提交并写入事件与审计记录。");
      await subscriptions.query.refetch();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "订阅操作失败");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    const ok = await post("/api/admin/subscriptions", {
      platformUserId: userId,
      planVersionId: versionId,
      startInTrial: trial,
      idempotencyKey: requestKey("activate"),
      reason: "Admin subscription activation",
    });
    if (ok) {
      setUserId("");
      setSelectedUserLabel("");
      setVersionId("");
      setTrial(false);
    }
  }

  async function transition(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const body: Record<string, unknown> = action === "grant_tokens"
      ? {
          idempotencyKey: requestKey("grant-tokens"),
          reason,
          amountTokens: Number(grantAmount),
          expectedAllowanceVersion: Number(selected.allowance_version),
        }
      : {
          idempotencyKey: requestKey(action),
          reason,
          expectedVersion: Number(selected.version),
        };
    if (["upgrade", "downgrade"].includes(action)) {
      body.planVersionId = targetVersion;
    }
    const ok = await post(
      `/api/admin/subscriptions/${encodeURIComponent(selected.id)}/${action === "grant_tokens" ? "grant-tokens" : action}`,
      body,
    );
    if (ok) closeActionDialog();
  }

  function closeActionDialog() {
    setSelected(null);
    setReason("");
    setTargetVersion("");
    setGrantAmount("");
  }

  function openActionDialog(row: Row, trigger: HTMLButtonElement) {
    manageTriggerRef.current = trigger;
    setSelected(row);
    setAction(grantIntent && grantAccess.data?.can ? "grant_tokens" : "renew");
    setTargetVersion("");
    setGrantAmount("");
    setReason("");
    setError("");
  }

  return <div className="space-y-6">
    {message ? <p className="border border-success/35 bg-success-light p-4 text-sm text-success" role="status">{message}</p> : null}
    {error && !selected ? <p className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</p> : null}

    <form onSubmit={activate} className="admin-panel space-y-5 p-5">
      <header>
        <h2 className="font-display text-xl font-semibold">为平台用户开通订阅</h2>
        <p id="platform-user-picker-help" className="mt-1 text-sm leading-6 text-text-secondary">canonical users 是唯一平台用户全集，每个平台用户天然具备订阅身份，不存在单独的“计费用户”名册。缺失内部兼容投影或非 active 的用户仍会显示，以便发现投影故障，但不能误开通订阅。</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] lg:items-end">
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-text-secondary">按邮箱搜索平台用户
            <input
              type="search"
              className="admin-field mt-2"
              value={userSearch}
              onChange={(event) => {
                setUserSearch(event.target.value);
                setUserPage(1);
              }}
              placeholder="输入完整或部分邮箱"
              aria-describedby="platform-user-picker-help"
            />
          </label>
          <label className="block text-xs font-semibold text-text-secondary">平台用户
            <select
              aria-label="平台用户"
              className="admin-field mt-2"
              required
              value={userId}
              disabled={users.query.isLoading}
              onChange={(event) => {
                const nextId = event.target.value;
                setUserId(nextId);
                const matched = users.result.data?.find((user) => user.id === nextId);
                setSelectedUserLabel(matched ? userLabel(matched) : "");
              }}
            >
              <option value="">{users.query.isLoading ? "正在加载平台用户…" : "选择平台用户"}</option>
              {userId && !users.result.data?.some((user) => user.id === userId) ? <option value={userId}>{selectedUserLabel || userId}</option> : null}
              {(users.result.data ?? []).map((user) => {
                const selection = userSelectionState(user);
                return <option key={user.id} value={user.id} disabled={!selection.selectable}>{userLabel(user)}{selection.suffix ? ` · ${selection.suffix}` : ""}</option>;
              })}
            </select>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
            <span>{users.query.error ? "平台用户加载失败" : `匹配 ${userTotal} 位 · 第 ${userPage} / ${userPages} 页`}</span>
            <span className="flex gap-2">
              <button type="button" disabled={userPage <= 1 || users.query.isFetching} onClick={() => setUserPage((current) => Math.max(1, current - 1))} className="min-h-10 border border-border px-3 disabled:opacity-40">上一页</button>
              <button type="button" disabled={userPage >= userPages || users.query.isFetching} onClick={() => setUserPage((current) => Math.min(userPages, current + 1))} className="min-h-10 border border-border px-3 disabled:opacity-40">下一页</button>
            </span>
          </div>
          {users.query.error ? <p className="text-xs text-danger" role="alert">{users.query.error.message}</p> : null}
        </div>
        <label className="text-xs font-semibold text-text-secondary">已发布月度版本
          <select className="admin-field mt-2" required value={versionId} onChange={(event) => setVersionId(event.target.value)}>
            <option value="">选择版本</option>
            {published.map((version) => <option key={version.id} value={version.id}>{String(version.plan_code)} · v{String(version.version_number)} · {formatToken(version.allowance_tokens)} Token/月</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={trial} onChange={(event) => setTrial(event.target.checked)} /> 从试用开始</label>
        <button disabled={pending || users.query.isLoading} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "提交中…" : "开通订阅"}</button>
      </div>
    </form>

    <section id="subscription-user-list" className="admin-panel overflow-hidden scroll-mt-24" aria-label="用户订阅清单">
      <header className="space-y-4 border-b border-border p-5">
        <div>
          <h2 className="font-display text-xl font-semibold">用户订阅与当前周期 Token</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">按用户核对套餐 Token、补发 Token、预留、消耗和剩余；这里的补发会立即参与 Gateway 预授权，但不修改 429 安全限流。</p>
        </div>
        {grantIntent ? <p className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary" role="status">正在处理 402：请确认目标用户后点击“管理”。具备 <span className="font-mono text-xs">subscriptions.grant</span> 权限时，弹窗会直接选择“补发本周期 Token”。</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block max-w-xl flex-1 text-xs font-semibold text-text-secondary">按邮箱筛选用户订阅
            <input
              type="search"
              className="admin-field mt-2"
              value={subscriptionSearch}
              onChange={(event) => {
                setSubscriptionSearch(event.target.value);
                setPage(1);
              }}
              placeholder="输入完整或部分邮箱"
            />
          </label>
          {subscriptionSearch ? <button type="button" className="min-h-11 border border-border px-4 text-sm font-semibold" onClick={() => { setSubscriptionSearch(""); setPage(1); }}>清除筛选</button> : null}
        </div>
      </header>
      <div className="max-w-full overflow-x-auto" tabIndex={0} aria-label="用户订阅数据表，可横向滚动">
        <table className="w-full min-w-[1540px] text-left text-sm">
          <caption className="sr-only">用户个人月度订阅周期及 Token Allowance 使用情况</caption>
          <thead className="border-b border-border bg-bg-secondary font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            <tr>{["用户", "套餐", "状态", "个人订阅周期", "套餐 Token", "补发 Token", "可用总额", "预留 Token", "已消耗 Token", "剩余 Token", "待生效版本", "操作"].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const granted = tokenValue(row.granted_tokens);
              const planGranted = tokenValue(row.plan_granted_tokens);
              const bonusGranted = tokenValue(row.bonus_granted_tokens);
              const reserved = tokenValue(row.reserved_tokens);
              const consumed = tokenValue(row.consumed_tokens);
              const remaining = Math.max(0, granted - reserved - consumed);
              return <tr key={row.id}>
                <th scope="row" className="px-4 py-3 text-left font-normal"><span className="font-semibold">{String(row.email ?? row.display_name ?? row.platform_user_id)}</span><span className="block font-mono text-[10px] text-text-tertiary">{row.id}</span></th>
                <td className="px-4 py-3">{String(row.plan_code)} · v{String(row.version_number)}</td>
                <td className="px-4 py-3"><span className="admin-status">{String(row.status)}</span></td>
                <td className="px-4 py-3 text-xs">{formatDate(row.current_period_start)} → {formatDate(row.current_period_end)}</td>
                <td className="px-4 py-3 font-mono">{formatToken(planGranted)}</td>
                <td className="px-4 py-3 font-mono">{formatToken(bonusGranted)}</td>
                <td className="px-4 py-3 font-mono">{formatToken(granted)}</td>
                <td className="px-4 py-3 font-mono">{formatToken(reserved)}</td>
                <td className="px-4 py-3 font-mono">{formatToken(consumed)}</td>
                <td className="px-4 py-3 font-mono font-semibold">{formatToken(remaining)}</td>
                <td className="max-w-[260px] break-all px-4 py-3 font-mono text-xs">{pendingVersionLabel(row)}</td>
                <td className="px-4 py-3"><button type="button" className="min-h-10 underline" onClick={(event) => openActionDialog(row, event.currentTarget)}>管理</button></td>
              </tr>;
            })}
            {!subscriptions.query.isLoading && rows.length === 0 ? <tr><td colSpan={12} className="px-5 py-14 text-center text-text-tertiary">{subscriptionSearch ? "没有匹配该邮箱的用户订阅。请核对邮箱，或先为用户开通订阅。" : "尚无用户订阅。请先发布包含月度 Token 额度与模型权益的套餐版本。"}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-xs"><span>共 {total} 条 · 第 {page} 页</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="min-h-10 border border-border px-3 disabled:opacity-40">上一页</button><button type="button" disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)} className="min-h-10 border border-border px-3 disabled:opacity-40">下一页</button></div></footer>
    </section>

    <dialog ref={dialogRef} className="admin-dialog admin-dialog--modal" onCancel={(event) => { event.preventDefault(); closeActionDialog(); }} aria-labelledby="subscription-action-title">
      {selected ? <form onSubmit={transition} className="admin-dialog-frame">
        <header className="admin-dialog-header">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Subscription lifecycle</p><h2 id="subscription-action-title" className="mt-2 font-display text-2xl font-semibold">管理用户订阅</h2><p className="mt-2 break-all font-mono text-[10px] text-text-tertiary">{selected.id}</p></div>
          <button type="button" className="min-h-11 border border-border px-4 text-sm" onClick={closeActionDialog}>关闭</button>
        </header>
        <div className="admin-dialog-body space-y-5">
          {error ? <p className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</p> : null}
          <dl className="grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-text-tertiary">当前周期结束</dt><dd className="mt-1 font-mono text-xs">{formatDate(selected.current_period_end)}</dd></div>
            <div><dt className="text-xs text-text-tertiary">当前剩余 Token</dt><dd className="mt-1 font-mono font-semibold">{formatToken(Math.max(0, tokenValue(selected.granted_tokens) - tokenValue(selected.reserved_tokens) - tokenValue(selected.consumed_tokens)))}</dd></div>
          </dl>
          {action === "renew" && new Date(String(selected.current_period_end)) <= new Date() ? <p className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary">如果该订阅已经漏过多个个人周期，服务端会从原始周期锚点直接定位到包含当前时刻的周期；已过期月份不会追溯补发 Token。</p> : null}
          <label className="block text-xs font-semibold text-text-secondary">操作
            <select data-dialog-autofocus className="admin-field mt-2" value={action} onChange={(event) => { setAction(event.target.value as Action); setTargetVersion(""); setError(""); }}>
              {visibleActionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary">{activeAction.description}</p>
          {action === "grant_tokens" ? <label className="block text-xs font-semibold text-text-secondary">补发 Token 数量 *
            <input required min={1} step={1} inputMode="numeric" type="number" className="admin-field mt-2 font-mono" value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} placeholder="例如 100000" />
          </label> : null}
          {["upgrade", "downgrade"].includes(action) ? <label className="block text-xs font-semibold text-text-secondary">下周期目标版本
            <select required className="admin-field mt-2" value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)}><option value="">选择已发布版本</option>{published.map((version) => <option key={version.id} value={version.id}>{String(version.plan_code)} · v{String(version.version_number)} · {formatToken(version.allowance_tokens)} Token/月</option>)}</select>
          </label> : null}
          <label className="block text-xs font-semibold text-text-secondary">操作原因 *<textarea required minLength={3} maxLength={500} className="admin-field mt-2 min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        <footer className="admin-dialog-footer"><button type="button" className="min-h-11 border border-border px-4" onClick={closeActionDialog}>取消</button><button disabled={pending} className={`min-h-11 px-5 font-semibold text-white disabled:opacity-50 ${action === "cancel" ? "bg-danger" : "bg-text-primary"}`}>{pending ? "处理中…" : "确认执行"}</button></footer>
      </form> : null}
    </dialog>
  </div>;
}
