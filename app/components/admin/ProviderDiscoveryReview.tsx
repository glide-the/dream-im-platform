"use client";

// [Input] A secret-safe discovery snapshot containing generic or managed product model diffs.
// [Output] Review/apply UI that keeps unsupported product models visible but impossible to select.
// [Pos] Admin catalog review surface; authorization and generation fences are enforced again by the server.
// [Sync] 2026-09-04: display product dialect compatibility and block unsupported model application.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminCollapsibleFilters, countActiveFilterValues } from "./AdminListChrome";

type DiffItem = {
  id: string;
  ownedBy: string | null;
  displayName: string;
  vendor?: string | null;
  upstreamDialect?: "openai_responses" | "openai_chat" | null;
  gatewayCompatible?: boolean;
  capabilities?: string[];
  proposedCode: string;
  state: "new" | "existing" | "conflict" | "unsupported";
  conflictReason?: string;
};

type Snapshot = {
  id: string;
  provider_id: string;
  provider_code: string;
  provider_name: string;
  status: "ready" | "applied" | "expired";
  endpoint: string;
  catalog_hash: string;
  diff: DiffItem[];
  expires_at: string;
  created_at: string;
};

export default function ProviderDiscoveryReview({ providerId, snapshotId }: { providerId: string; snapshotId: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | DiffItem["state"]>("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/provider-discovery/${encodeURIComponent(snapshotId)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "模型差异快照加载失败");
      const data = body.data as Snapshot;
      setSnapshot(data);
      setSelected(new Set(data.diff.filter((item) => item.state === "new").map((item) => item.id)));
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "模型差异快照加载失败");
    });
    return () => controller.abort();
  }, [snapshotId]);

  const visible = useMemo(() => snapshot?.diff.filter((item) => {
    if (filter !== "all" && item.state !== filter) return false;
    const term = search.trim().toLowerCase();
    return !term || `${item.id} ${item.displayName} ${item.ownedBy ?? ""} ${item.proposedCode}`.toLowerCase().includes(term);
  }) ?? [], [filter, search, snapshot]);
  const selectableVisible = visible.filter((item) => item.state === "new" || item.state === "existing");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (!snapshot || selected.size === 0) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/apply-discovery`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ snapshotId, modelIds: [...selected] }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? `应用失败（HTTP ${response.status}）`);
      router.push(`/admin/models/models?provider_id=${encodeURIComponent(providerId)}&synced=${encodeURIComponent(snapshotId)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "应用模型差异失败");
    } finally {
      setPending(false);
    }
  }

  const counts = snapshot ? {
    new: snapshot.diff.filter((item) => item.state === "new").length,
    existing: snapshot.diff.filter((item) => item.state === "existing").length,
    conflict: snapshot.diff.filter((item) => item.state === "conflict").length,
    unsupported: snapshot.diff.filter((item) => item.state === "unsupported").length,
  } : { new: 0, existing: 0, conflict: 0, unsupported: 0 };
  const unavailable = !snapshot || snapshot.status !== "ready" || new Date(snapshot.expires_at) <= new Date();

  return (
    <section className="fixed inset-0 z-[80] flex min-h-[100dvh] flex-col overflow-hidden bg-bg-primary">
      <header className="shrink-0 border-b border-border bg-bg-surface">
        <div className="mx-auto flex min-h-16 max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><Link href="/admin/models/providers" className="grid h-11 w-11 place-items-center border border-border" aria-label="返回 Provider">←</Link><div className="min-w-0"><p className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary sm:block">cc-switch · model fetch · diff review</p><h1 className="truncate font-display text-xl font-semibold">模型目录差异确认</h1></div></div>
          <span className="hidden font-mono text-[10px] text-text-tertiary sm:block">SNAPSHOT · {snapshotId.slice(-10)}</span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1360px] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-2xl border border-border bg-bg-surface p-5"><p className="font-mono text-[10px] uppercase text-text-tertiary">Provider</p><h2 className="mt-2 text-lg font-semibold">{snapshot?.provider_name ?? "加载中…"}</h2><p className="mt-1 font-mono text-xs text-accent">{snapshot?.provider_code}</p><p className="mt-4 break-all text-xs leading-5 text-text-tertiary">目录端点：{snapshot?.endpoint ?? "—"}</p></section>
            <dl className="grid grid-cols-4 rounded-2xl border border-border bg-bg-surface text-center"><div className="p-3"><dt className="text-[10px] text-text-tertiary">新增</dt><dd className="mt-1 font-mono text-lg font-semibold text-accent">{counts.new}</dd></div><div className="border-x border-border p-3"><dt className="text-[10px] text-text-tertiary">已有</dt><dd className="mt-1 font-mono text-lg font-semibold">{counts.existing}</dd></div><div className="border-r border-border p-3"><dt className="text-[10px] text-text-tertiary">冲突</dt><dd className="mt-1 font-mono text-lg font-semibold text-danger">{counts.conflict}</dd></div><div className="p-3"><dt className="text-[10px] text-text-tertiary">不兼容</dt><dd className="mt-1 font-mono text-lg font-semibold text-accent-orange">{counts.unsupported}</dd></div></dl>
            <p className="rounded-2xl border border-border bg-bg-secondary p-4 text-xs leading-5 text-text-secondary">新增模型以 disabled 写入；已有模型只刷新目录元数据；冲突和当前 Gateway 不兼容的条目禁止勾选。模型启用和价格配置仍是后续独立操作。</p>
          </aside>
          <main className="min-w-0 overflow-hidden rounded-2xl border border-border bg-bg-surface">
            <AdminCollapsibleFilters activeCount={countActiveFilterValues({ search, filter: filter === "all" ? "" : filter })}>
              <div className="grid gap-3 sm:grid-cols-[minmax(200px,1fr)_auto]"><input className="admin-field min-h-11 bg-bg-surface text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型 ID、Owner 或 alias" aria-label="搜索模型差异" /><div className="flex max-w-full gap-1 overflow-x-auto bg-bg-secondary p-1">{(["all", "new", "existing", "conflict", "unsupported"] as const).map((state) => <button key={state} type="button" onClick={() => setFilter(state)} className={`min-h-9 whitespace-nowrap px-3 text-xs font-semibold ${filter === state ? "bg-bg-surface shadow-soft" : "text-text-tertiary"}`}>{state === "all" ? "全部" : state === "new" ? "新增" : state === "existing" ? "已有" : state === "conflict" ? "冲突" : "不兼容"}</button>)}</div></div>
            </AdminCollapsibleFilters>
            <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="border-b border-border">{["选择", "上游模型 ID", "Owner / 协议", "拟用 alias", "差异状态"].map((label) => <th key={label} className="px-4 py-3 font-mono text-[10px] uppercase text-text-tertiary">{label}</th>)}</tr></thead><tbody>{visible.map((item) => <tr key={item.id} className="border-b border-border align-top"><td className="px-4 py-4"><input type="checkbox" className="h-5 w-5 accent-current" checked={selected.has(item.id)} disabled={!["new", "existing"].includes(item.state) || unavailable} onChange={() => toggle(item.id)} aria-label={`选择 ${item.id}`} /></td><td className="px-4 py-4"><span className="font-mono text-xs font-semibold">{item.id}</span><span className="mt-1 block text-xs text-text-tertiary">{item.displayName}</span></td><td className="px-4 py-4 text-xs text-text-secondary">{item.ownedBy ?? "—"}<span className="mt-1 block font-mono text-[10px] text-text-tertiary">{item.upstreamDialect ?? "通用目录"}</span></td><td className="px-4 py-4 font-mono text-xs">{item.proposedCode}</td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${item.state === "conflict" ? "border-danger/35 bg-danger-light text-danger" : item.state === "unsupported" ? "border-warning/40 bg-accent-orange-light text-accent-orange" : item.state === "new" ? "border-accent/35 bg-accent-light text-accent" : "border-border bg-bg-secondary text-text-secondary"}`}>{item.state}</span>{item.conflictReason ? <p className={`mt-2 max-w-xs text-xs leading-5 ${item.state === "unsupported" ? "text-accent-orange" : "text-danger"}`}>{item.conflictReason}</p> : null}</td></tr>)}{!snapshot ? <tr><td colSpan={5} className="p-12 text-center text-sm text-text-tertiary">正在读取差异快照…</td></tr> : visible.length === 0 ? <tr><td colSpan={5} className="p-12 text-center text-sm text-text-tertiary">没有匹配的差异项</td></tr> : null}</tbody></table></div>
            <div className="flex items-center justify-between gap-3 border-t border-border p-4"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const item of selectableVisible) { if (event.target.checked) next.add(item.id); else next.delete(item.id); } return next; })} disabled={unavailable} />选择当前筛选结果</label><span className="font-mono text-xs text-text-tertiary">已选 {selected.size}</span></div>
          </main>
        </div>
      </div>
      {error ? <div className="shrink-0 border-t border-danger/35 bg-danger-light px-5 py-3 text-sm text-danger" role="alert">{error}</div> : null}
      <footer className="shrink-0 border-t border-border bg-bg-surface"><div className="mx-auto flex min-h-20 max-w-[1360px] items-center justify-end gap-3 px-4 sm:px-6"><Link href="/admin/models/providers" className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 text-sm font-semibold">稍后处理</Link><button type="button" disabled={pending || selected.size === 0 || unavailable} onClick={apply} className="min-h-11 rounded-xl bg-text-primary px-6 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "应用中…" : `应用 ${selected.size} 个模型`}</button></div></footer>
    </section>
  );
}
