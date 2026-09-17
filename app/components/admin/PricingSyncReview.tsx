"use client";

// [Input] Pricing snapshot with catalog candidate details and explicit operator selections.
// [Output] Collapsible candidate comparison and versioned apply through the authenticated Admin API.
// [Pos] Full-screen pricing review; server owns prices, candidate membership, authorization and audit.
// [Sync] 2026-09-14: show all ambiguous candidates, require a choice and support legacy snapshot resync.
import { useInvalidate } from "@refinedev/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { PricingSyncMatch } from "@/lib/admin/pricing-sync";
import { AdminCollapsibleFilters, countActiveFilterValues } from "./AdminListChrome";

type MatchState = "exact" | "normalized" | "ambiguous" | "unmatched";
type Snapshot = {
  id: string;
  provider_id: string | null;
  catalog_ref: string;
  catalog_version: string;
  catalog_hash: string;
  status: "ready" | "applied" | "expired";
  matches: PricingSyncMatch[];
  expires_at: string;
  created_at: string;
};

function localDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function usd(microusd: string) {
  try {
    const value = BigInt(microusd);
    const whole = value / 1_000_000n;
    const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return `$${whole}${fraction ? `.${fraction}` : ""}`;
  } catch { return "—"; }
}

export default function PricingSyncReview({ snapshotId }: { snapshotId: string }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [candidateChoices, setCandidateChoices] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | MatchState>("all");
  const [search, setSearch] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(localDateTime());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(undefined);
    setSelected(new Set());
    setCandidateChoices({});
    setExpanded(new Set());
    setError("");
    fetch(`/api/admin/pricing-sync/${encodeURIComponent(snapshotId)}`, {
      headers: { accept: "application/json" }, signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "价格同步快照加载失败");
      const data = body.data as Snapshot;
      setSnapshot(data);
      setSelected(new Set(data.matches.filter((item) => item.match === "exact").map((item) => item.localModelId)));
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "价格同步快照加载失败");
    });
    return () => controller.abort();
  }, [snapshotId]);

  const visible = useMemo(() => snapshot?.matches.filter((item) => {
    if (filter !== "all" && item.match !== filter) return false;
    const term = search.trim().toLowerCase();
    return !term || `${item.localModelCode} ${item.upstreamModel} ${item.providerCode} ${item.modelName}`.toLowerCase().includes(term);
  }) ?? [], [filter, search, snapshot]);
  const selectable = visible.filter((item) => item.match === "exact" || item.match === "normalized" || (
    item.match === "ambiguous" && item.candidateDetails?.some((candidate) => candidate.key === candidateChoices[item.localModelId])
  ));
  const counts = snapshot ? Object.fromEntries((["exact", "normalized", "ambiguous", "unmatched"] as const).map((state) => [state, snapshot.matches.filter((item) => item.match === state).length])) as Record<MatchState, number> : { exact: 0, normalized: 0, ambiguous: 0, unmatched: 0 };
  const unavailable = pending || !snapshot || snapshot.status !== "ready" || new Date(snapshot.expires_at) <= new Date();

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function chooseCandidate(id: string, key: string) {
    setCandidateChoices((current) => ({ ...current, [id]: key }));
    setSelected((current) => new Set(current).add(id));
    setError("");
  }

  async function resync() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/pricing-sync", {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ force: true, ...(snapshot?.provider_id ? { providerId: snapshot.provider_id } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data?.id) throw new Error(body.error?.message ?? "重新同步失败");
      router.push(`/admin/models/pricing/sync/${encodeURIComponent(body.data.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新同步失败");
    } finally { setPending(false); }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (selected.size === 0) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/admin/pricing-sync/${encodeURIComponent(snapshotId)}/apply`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          modelIds: [...selected], effectiveFrom: new Date(effectiveFrom).toISOString(),
          candidateSelections: [...selected].filter((id) => candidateChoices[id]).map((id) => ({ localModelId: id, key: candidateChoices[id] })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? `应用价格失败（HTTP ${response.status}）`);
      await invalidate({ resource: "pricing-rules", invalidates: ["list", "detail"] });
      router.push(`/admin/models/pricing?synced=${encodeURIComponent(snapshotId)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "应用价格失败");
    } finally { setPending(false); }
  }

  return (
    <section className="fixed inset-0 z-[80] flex min-h-[100dvh] flex-col overflow-hidden bg-bg-primary">
      <header className="shrink-0 border-b border-border bg-bg-surface"><div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><Link href="/admin/models/pricing" className="grid h-11 w-11 place-items-center border border-border" aria-label="返回 Pricing">←</Link><div><p className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary sm:block">cc-switch · models.dev · versioned apply</p><h1 className="font-display text-xl font-semibold">价格目录差异确认</h1></div></div><span className="hidden font-mono text-[10px] text-text-tertiary sm:block">CATALOG · {snapshot?.catalog_version ?? "loading"}</span></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto grid max-w-[1440px] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start"><section className="rounded-2xl border border-border bg-bg-surface p-5"><p className="font-mono text-[10px] uppercase text-text-tertiary">Price source</p><h2 className="mt-2 text-lg font-semibold">models.dev</h2><p className="mt-2 break-all font-mono text-[10px] text-accent">{snapshot?.catalog_ref ?? "https://models.dev/api.json"}</p><p className="mt-4 text-xs leading-5 text-text-secondary">与 cc-switch 一致读取四类 Token 价格；应用时创建 PostgreSQL 新版本，不覆盖历史价格和账单快照。</p></section><dl className="grid grid-cols-2 rounded-2xl border border-border bg-bg-surface text-center"><div className="p-4"><dt className="text-[10px] text-text-tertiary">精确匹配</dt><dd className="mt-1 font-mono text-lg font-semibold text-success">{counts.exact}</dd></div><div className="border-l border-border p-4"><dt className="text-[10px] text-text-tertiary">规范化</dt><dd className="mt-1 font-mono text-lg font-semibold text-accent">{counts.normalized}</dd></div><div className="border-t border-border p-4"><dt className="text-[10px] text-text-tertiary">歧义</dt><dd className="mt-1 font-mono text-lg font-semibold text-danger">{counts.ambiguous}</dd></div><div className="border-l border-t border-border p-4"><dt className="text-[10px] text-text-tertiary">未匹配</dt><dd className="mt-1 font-mono text-lg font-semibold">{counts.unmatched}</dd></div></dl><label className="block rounded-2xl border border-border bg-bg-surface p-4 text-xs font-semibold text-text-secondary">新版本生效时间<input type="datetime-local" className="admin-field mt-2 text-sm" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></label></aside>
        <main className="min-w-0 overflow-hidden rounded-2xl border border-border bg-bg-surface"><AdminCollapsibleFilters activeCount={countActiveFilterValues({ search, filter: filter === "all" ? "" : filter })}><div className="grid gap-3 sm:grid-cols-[minmax(200px,1fr)_auto]"><input className="admin-field min-h-11 bg-bg-surface text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索本地 alias、上游模型或 Provider" aria-label="搜索价格匹配" /><div className="flex max-w-full gap-1 overflow-x-auto bg-bg-secondary p-1">{(["all", "exact", "normalized", "ambiguous", "unmatched"] as const).map((state) => <button key={state} type="button" onClick={() => setFilter(state)} className={`min-h-9 whitespace-nowrap px-3 text-xs font-semibold ${filter === state ? "bg-bg-surface shadow-soft" : "text-text-tertiary"}`}>{state === "all" ? "全部" : state}</button>)}</div></div></AdminCollapsibleFilters>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead><tr className="border-b border-border">{["选择", "本地模型", "models.dev 匹配", "Input", "Output", "Cache read", "Cache write", "匹配状态"].map((label) => <th key={label} className="px-4 py-3 font-mono text-[10px] uppercase text-text-tertiary">{label}</th>)}</tr></thead>
              <tbody>
                {visible.map((item) => {
                  const ambiguous = item.match === "ambiguous";
                  const choice = item.candidateDetails?.find((candidate) => candidate.key === candidateChoices[item.localModelId]);
                  const displayed = ambiguous ? choice : item;
                  const enabled = item.match === "exact" || item.match === "normalized" || Boolean(choice);
                  const isExpanded = expanded.has(item.localModelId);
                  const panelId = `pricing-candidates-${encodeURIComponent(item.localModelId)}`;
                  return <Fragment key={item.localModelId}>
                    <tr className="border-b border-border align-top">
                      <td className="px-4 py-4"><input type="checkbox" className="h-5 w-5" checked={selected.has(item.localModelId)} disabled={!enabled || unavailable} onChange={() => toggle(item.localModelId)} aria-label={`选择 ${item.localModelCode}`} /></td>
                      <td className="px-4 py-4"><span className="font-semibold">{item.localModelCode}</span><span className="mt-1 block font-mono text-[10px] text-text-tertiary">{item.providerCode} · {item.upstreamModel}</span></td>
                      <td className="px-4 py-4">
                        <span className="text-xs font-semibold">{displayed?.modelName || (ambiguous ? "请选择价格来源" : "—")}</span>
                        <span className="mt-1 block font-mono text-[10px] text-text-tertiary">{displayed?.key || (ambiguous ? "尚未选择候选" : "无候选")}</span>
                        {ambiguous ? <button type="button" className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-accent focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={isExpanded} aria-controls={panelId} aria-label={`${isExpanded ? "收起" : "展开"} ${item.localModelCode} 的 ${item.candidates?.length ?? 0} 个候选`} onClick={() => toggleExpanded(item.localModelId)}>
                          <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>{item.candidates?.length ?? 0} 个候选 · {isExpanded ? "收起" : choice ? "更换来源" : "展开选择"}
                        </button> : null}
                      </td>
                      {[displayed?.inputMicrousd, displayed?.outputMicrousd, displayed?.cacheReadMicrousd, displayed?.cacheWriteMicrousd].map((value, index) => <td key={index} className="px-4 py-4 font-mono text-xs">{displayed?.key && value !== undefined ? usd(value) : "—"}<span className="mt-1 block text-[9px] text-text-tertiary">/ 1M</span></td>)}
                      <td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${choice ? "border-accent/35 bg-accent-light text-accent" : item.match === "exact" ? "border-success/35 bg-success-light text-success" : item.match === "normalized" ? "border-accent/35 bg-accent-light text-accent" : "border-danger/35 bg-danger-light text-danger"}`}>{choice ? "人工选择" : item.match}</span></td>
                    </tr>
                    {ambiguous && isExpanded ? <tr className="border-b border-border bg-bg-secondary/50"><td colSpan={8} className="p-4">
                      <fieldset id={panelId} className="min-w-0 rounded-xl border border-border bg-bg-surface p-4">
                        <legend className="px-2 text-xs font-semibold">{item.localModelCode} · 选择价格来源</legend>
                        {item.candidateDetails?.length ? <>
                          <p className="mb-3 text-xs text-text-secondary">选择一个来源后，将使用该来源的四类价格创建新版本。</p>
                          <table className="w-full text-left text-xs">
                            <thead><tr className="border-b border-border">{["选择", "Provider / 模型", "Input", "Output", "Cache read", "Cache write"].map((label) => <th key={label} className="px-3 py-2 font-mono text-[10px] uppercase text-text-tertiary">{label}</th>)}</tr></thead>
                            <tbody>{item.candidateDetails.map((candidate) => <tr key={candidate.key} className={`border-b border-border last:border-0 ${choice?.key === candidate.key ? "bg-accent-light" : "hover:bg-bg-secondary"}`}>
                              <td className="px-3 py-3"><input id={`${panelId}-${encodeURIComponent(candidate.key)}`} type="radio" className="h-4 w-4 accent-accent" name={`pricing-source-${item.localModelId}`} value={candidate.key} checked={choice?.key === candidate.key} disabled={unavailable} onChange={() => chooseCandidate(item.localModelId, candidate.key)} aria-label={`为 ${item.localModelCode} 选择 ${candidate.key}`} /></td>
                              <td className="px-3 py-3"><label htmlFor={`${panelId}-${encodeURIComponent(candidate.key)}`} className="block cursor-pointer"><span className="font-semibold">{candidate.providerName} · {candidate.modelName}</span><span className="mt-1 block break-all font-mono text-[10px] text-text-tertiary">{candidate.key}</span></label></td>
                              {[candidate.inputMicrousd, candidate.outputMicrousd, candidate.cacheReadMicrousd, candidate.cacheWriteMicrousd].map((value, index) => <td key={index} className="px-3 py-3 font-mono">{usd(value)}<span className="ml-1 text-[9px] text-text-tertiary">/ 1M</span></td>)}
                            </tr>)}</tbody>
                          </table>
                        </> : <div className="space-y-3">
                          <p className="text-xs text-text-secondary">此快照未保存候选价格，重新同步后即可比较和选择。</p>
                          <ul className="space-y-1 font-mono text-[10px] text-text-tertiary">{item.candidates?.map((key) => <li key={key}>{key}</li>)}</ul>
                          <button type="button" className="min-h-10 rounded-lg border border-accent/35 bg-accent-light px-3 text-xs font-semibold text-accent disabled:opacity-50" disabled={pending} onClick={resync}>{pending ? "正在重新同步…" : "重新同步以加载候选价格"}</button>
                        </div>}
                      </fieldset>
                    </td></tr> : null}
                  </Fragment>;
                })}
                {!snapshot ? <tr><td colSpan={8} className="p-12 text-center text-text-tertiary">正在读取价格目录差异…</td></tr> : visible.length === 0 ? <tr><td colSpan={8} className="p-12 text-center text-text-tertiary">没有匹配项</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border p-4"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={selectable.length > 0 && selectable.every((item) => selected.has(item.localModelId))} disabled={unavailable} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const item of selectable) { if (event.target.checked) next.add(item.localModelId); else next.delete(item.localModelId); } return next; })} />选择当前可应用项</label><span className="font-mono text-xs text-text-tertiary">已选 {selected.size}</span></div>
        </main>
      </div></div>
      {error ? <div className="shrink-0 border-t border-danger/35 bg-danger-light px-5 py-3 text-sm text-danger" role="alert">{error}</div> : null}
      <footer className="shrink-0 border-t border-border bg-bg-surface"><div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-end gap-3 px-4 sm:px-6"><Link href="/admin/models/pricing" className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 text-sm font-semibold">稍后处理</Link><button type="button" disabled={pending || selected.size === 0 || !effectiveFrom || unavailable} onClick={apply} className="min-h-11 rounded-xl bg-text-primary px-6 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "创建价格版本中…" : `应用 ${selected.size} 个价格版本`}</button></div></footer>
    </section>
  );
}
