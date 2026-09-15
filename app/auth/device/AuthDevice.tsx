// [Input] Browser Session and user-entered device user code.
// [Output] Registered client/resource/scope review with one approve/deny decision.
// [Pos] Device authorization UI; only installed OAuth device APIs issue grants.
"use client";
import { useState, useEffect } from "react";
import { z } from "zod";
const contextDto = z.object({ user_code: z.string(), status: z.enum(["pending", "approved", "denied"]), client_id: z.string().optional(), scope: z.string().optional(), resource: z.union([z.string(), z.array(z.string())]).optional() });
export default function AuthDevice() {
  const [code, setCode] = useState(""), [context, setContext] = useState<z.infer<typeof contextDto> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setCode(new URLSearchParams(window.location.search).get("user_code") ?? ""); }, []);
  async function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setContext(null);
    try {
      const normalized = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(normalized)) { setError("请输入设备上显示的授权码。"); return; }
      const response = await fetch(`/api/auth/device?${new URLSearchParams({ user_code: normalized })}`, { cache: "no-store" });
      if (!response.ok) { setError("授权码无效或已过期，请在设备上重新发起授权。"); return; }
      const result = contextDto.parse(await response.json());
      if (!result.client_id) { window.location.assign(`/auth/sign-in?${new URLSearchParams({ return_to: `/auth/device?${new URLSearchParams({ user_code: normalized })}` })}`); return; }
      setContext(result);
    } catch { setError("暂时无法读取授权请求，请重试。"); } finally { setBusy(false); }
  }
  async function decide(accept: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/device/${accept ? "approve" : "deny"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userCode: context?.user_code }) });
      if (!response.ok) { setError("请求已处理或已过期，请在设备上查看结果。"); return; }
      setContext(previous => previous ? { ...previous, status: accept ? "approved" : "denied" } : previous);
    } catch { setError("暂时无法完成授权，请重试。"); } finally { setBusy(false); }
  }
  return <><h1 className="text-2xl font-semibold">授权设备</h1><form onSubmit={review} className="mt-7"><label className="block text-sm">设备授权码<input name="user_code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" required className="mt-2 w-full rounded-xl border border-border-default px-4 py-3 font-mono uppercase" /></label><button disabled={busy} className="mt-4 w-full rounded-xl border border-border-default px-4 py-3 disabled:opacity-50">查看授权请求</button></form>
    {context && (context.status === "pending" ? <div className="mt-7"><p>应用：{context.client_id}</p><p className="mt-3 break-all text-sm">访问目标：{Array.isArray(context.resource) ? context.resource.join("、") : context.resource}</p><p className="mt-3 text-sm">请求权限：{context.scope}</p><div className="mt-5 flex gap-3"><button disabled={busy} onClick={() => decide(false)} className="flex-1 rounded-xl border border-border-default py-3">拒绝</button><button disabled={busy} onClick={() => decide(true)} className="flex-1 rounded-xl bg-text-primary py-3 text-bg-primary">允许</button></div></div> : <p role="status" className="mt-7">{context.status === "approved" ? "已授权，请返回设备继续。" : "已拒绝此请求。"}</p>)}
    {error && <p role="alert" className="mt-5 text-sm text-red-600">{error}</p>}</>;
}
