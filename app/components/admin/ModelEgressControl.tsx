// [Input] Safe model-network projection, Provider permissions and explicit toggle actions.
// [Output] Accessible Docker NAT switch with save, conflict and unavailable feedback.
// [Pos] Shared Provider-page network control; endpoints and credentials stay on the server.
"use client";
import { useCan } from "@refinedev/core";
import { useCallback, useEffect, useState } from "react";
import type { ModelEgressPolicy } from "@/lib/model-egress-policy";

export default function ModelEgressControl() {
  const access = useCan({ resource: "providers", action: "edit" });
  const [policy, setPolicy] = useState<ModelEgressPolicy | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setError("");
      const response = await fetch("/api/admin/model-egress", { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "无法读取代理设置");
      setPolicy(body.data);
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "无法读取代理设置"); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function toggle() {
    if (!policy || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/model-egress", { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !policy.desiredEnabled, expectedRevision: policy.revision }) });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "代理设置保存失败");
      setPolicy(body.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "代理设置保存失败"); }
    finally { setPending(false); }
  }
  return <section className="admin-panel p-4 sm:p-5" aria-label="模型网络设置">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">本机 Docker NAT 代理</h2>
        <p className="mt-1 text-sm text-text-secondary">统一用于所有供应商请求和价格目录同步。关闭后使用服务器原有网络设置。</p>
        <p className="mt-2 text-sm text-text-tertiary" role="status">{pending ? "正在保存…" : !policy ? error ? "设置暂不可用" : "正在读取设置…" : policy.status === "enabled" ? "已启用" : policy.status === "unavailable" ? "期望启用，当前代理配置不可用" : "已关闭"}</p>
        {policy && !policy.configured ? <p className="mt-1 text-sm text-text-secondary">服务器尚未配置可用的本机代理地址，请联系运维配置。</p> : null}
      </div>
      <button type="button" role="switch" aria-label="启用本机 Docker NAT 代理" aria-checked={policy?.desiredEnabled ?? false}
        disabled={!policy || pending || !access.data?.can || (!policy.configured && !policy.desiredEnabled)} onClick={() => void toggle()}
        className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
        <span aria-hidden="true" className={`relative h-6 w-11 rounded-full ${policy?.desiredEnabled ? "bg-accent" : "bg-text-tertiary"}`}><span className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white transition-transform ${policy?.desiredEnabled ? "translate-x-6" : "translate-x-1"}`} /></span>
        {policy?.desiredEnabled ? "关闭代理" : "启用代理"}
      </button>
    </div>
    {error ? <div role="alert" className="mt-3 text-sm text-danger">{error}<button type="button" disabled={pending} onClick={() => void load()} className="ml-3 min-h-10 underline">重新读取设置</button></div> : null}
  </section>;
}
