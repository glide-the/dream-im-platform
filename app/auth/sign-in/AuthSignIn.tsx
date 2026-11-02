// [Input] Restricted local return and user-entered password/Google registration choice.
// [Output] Same-origin official Better Auth sign-in, preserving OAuth query through its plugin.
// [Pos] Login product interaction; credentials never enter storage or diagnostics.
// [Sync] 2026-11-02: resume the signed Google choice once; error callbacks retain the original retry controls.
// [Sync] 2026-11-02: remove provider-added public errors before reusing the original signed OAuth query.
"use client";
import { useEffect, useRef, useState } from "react";
import { adminAuthClient } from "../../lib/auth/client";
import { authResponseRedirect, googleLoginCallback } from "../../lib/auth/browserRedirect";
export default function AuthSignIn({ returnTo, selectedGoogle = false }: { returnTo: string; selectedGoogle?: boolean }) {
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const googleStarted = useRef(false);
  useEffect(() => {
    if (window.location.hash === "#google-error") {
      const returned = new URL(window.location.href);
      returned.searchParams.delete("error"); returned.searchParams.delete("error_description");
      window.history.replaceState(window.history.state, "", returned);
      setError("Google 登录暂时不可用，请重试。"); return;
    }
    if (!selectedGoogle || googleStarted.current) return;
    googleStarted.current = true;
    void google();
    // The selected provider belongs to this mounted signed login document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGoogle]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const credentials = { email: String(form.get("email")), password: String(form.get("password")), callbackURL: returnTo };
      const result = register ? await adminAuthClient.signUp.email({ ...credentials, name: String(form.get("name")) }) : await adminAuthClient.signIn.email(credentials);
      if (result.error) { setError(result.error.code === "LEGACY_SUBJECT_LINK_REQUIRED" ? "此账号需要完成已有身份关联，请联系管理员。" : "登录未完成，请检查账号信息后重试。"); return; }
      window.location.assign(authResponseRedirect(result.data) ?? returnTo);
    } catch { setError("暂时无法登录，请稍后重试。"); } finally { setBusy(false); }
  }
  async function google() {
    setBusy(true); setError("");
    try {
      const callbackURL = googleLoginCallback(window.location.origin, returnTo, window.location.search);
      const result = await adminAuthClient.signIn.social({ provider: "google", callbackURL, errorCallbackURL: `${callbackURL}#google-error` });
      if (result.error) setError("Google 登录暂时不可用，请重试。");
    }
    catch { setError("Google 登录暂时不可用，请重试。"); } finally { setBusy(false); }
  }
  const field = "mt-2 w-full rounded-xl border border-border-default bg-bg-primary px-4 py-3 outline-none focus:ring-2 focus:ring-accent-primary";
  if (selectedGoogle && !error) return <p role="status">正在打开 Google 登录…</p>;
  return <><h1 className="text-2xl font-semibold">{register ? "创建账号" : "登录"}</h1><form onSubmit={submit} className="mt-7 space-y-5">
    {register && <label className="block text-sm">名称<input className={field} name="name" autoComplete="name" required /></label>}
    <label className="block text-sm">邮箱<input className={field} type="email" name="email" autoComplete="email" required /></label>
    <label className="block text-sm">密码<input className={field} type="password" name="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 6 : undefined} required /></label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button disabled={busy} className="w-full rounded-xl bg-text-primary px-4 py-3 font-medium text-bg-primary disabled:opacity-50">{busy ? "正在处理…" : register ? "创建账号" : "登录"}</button>
  </form><button type="button" onClick={google} disabled={busy} className="mt-4 w-full rounded-xl border border-border-default px-4 py-3 disabled:opacity-50">使用 Google 登录</button><button type="button" disabled={busy} onClick={() => { setRegister(!register); setError(""); }} className="mt-6 text-sm text-text-secondary">{register ? "已有账号？登录" : "创建账号"}</button></>;
}
