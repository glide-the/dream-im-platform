// [Input] Server-validated client/scopes/resource display context.
// [Output] One accept/deny action through the installed signed-query provider client.
// [Pos] OAuth consent interaction; no duplicate confirmation.
"use client";
import { useState } from "react";
import { adminAuthClient } from "../../lib/auth/client";
import { authResponseRedirect } from "../../lib/auth/browserRedirect";
const labels: Record<string, string> = { openid: "确认登录身份", profile: "读取个人资料", email: "读取邮箱", offline_access: "保持登录", "dream:read": "读取 Dream 中的数据", "dream:write": "保存 Dream 中的数据", "product:read": "读取模型及订阅信息", "product:write": "更新产品设置", "messages:create": "使用模型并按实际用量计费", "messages:count_tokens": "计算输入 Token", "models:list": "读取可用模型" };
export default function AuthConsent({ context }: { context: { clientName: string; scopes: string[]; resource: string } }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function decide(accept: boolean) {
    setBusy(true); setError("");
    try {
      const result = await adminAuthClient.oauth2.consent({ accept });
      if (result.error) { setError("授权未完成，请重新发起登录。"); return; }
      const redirect = authResponseRedirect(result.data);
      if (!redirect) { setError("授权未完成，请重新发起登录。"); return; }
      window.location.assign(redirect);
    } catch { setError("暂时无法完成授权，请重试。"); } finally { setBusy(false); }
  }
  return <><h1 className="text-2xl font-semibold">允许 {context.clientName} 访问账号？</h1><p className="mt-4 text-sm text-text-secondary">授权后，该应用可以：</p><ul className="my-6 space-y-3 text-sm">{context.scopes.map(scope => <li key={scope}>• {labels[scope] ?? scope}</li>)}</ul><p className="break-all text-xs text-text-secondary">访问目标：{context.resource}</p>{error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}<div className="mt-7 flex gap-3"><button disabled={busy} onClick={() => decide(false)} className="flex-1 rounded-xl border border-border-default px-4 py-3 disabled:opacity-50">拒绝</button><button disabled={busy} onClick={() => decide(true)} className="flex-1 rounded-xl bg-text-primary px-4 py-3 text-bg-primary disabled:opacity-50">{busy ? "正在处理…" : "允许"}</button></div></>;
}
