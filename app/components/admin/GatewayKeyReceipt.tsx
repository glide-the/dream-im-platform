"use client";

import { useState } from "react";

export default function GatewayKeyReceipt({
  plaintextKey,
  gatewayBaseUrl,
}: {
  plaintextKey: string;
  gatewayBaseUrl: string;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const baseUrl = gatewayBaseUrl.replace(/\/+$/, "");
  const messagesUrl = `${baseUrl}/v1/messages`;
  const environment = [
    `ANTHROPIC_BASE_URL=${baseUrl}`,
    `ANTHROPIC_AUTH_TOKEN=${plaintextKey}`,
  ].join("\n");

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label}已复制。`);
    } catch {
      setCopyStatus(`${label}复制失败，请手动选择并复制。`);
    }
  }

  return (
    <section className="mb-5 overflow-hidden border border-warning/50 bg-accent-orange-light" aria-labelledby="gateway-key-receipt-title">
      <header className="border-b border-warning/35 p-4 sm:p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-orange">One-time gateway setup</p>
        <h3 id="gateway-key-receipt-title" className="mt-2 font-display text-xl font-semibold">Gateway Key 接入配置</h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">Token 只显示一次。请立即复制完整配置；关闭本回执后，列表和详情只保留 Key 前缀。</p>
      </header>

      <div className="space-y-5 p-4 sm:p-5">
        <section>
          <p className="text-xs font-semibold text-text-secondary">网关根地址</p>
          <code aria-label="网关根地址" className="mt-2 block break-all border border-border bg-bg-surface p-3 text-xs text-text-primary">{baseUrl}</code>
          <button type="button" onClick={() => void copy(baseUrl, "网关地址")} className="mt-2 min-h-10 border border-border bg-bg-surface px-4 text-xs font-semibold">复制地址</button>
        </section>

        <section>
          <p className="text-xs font-semibold text-text-secondary">Anthropic Messages 入口</p>
          <code aria-label="Anthropic Messages 入口" className="mt-2 block break-all border border-border bg-bg-surface p-3 text-xs text-text-primary">{messagesUrl}</code>
          <p className="mt-2 text-xs leading-5 text-text-secondary">Claude/Anthropic 客户端使用稳定模型 alias；客户端会通过该网关调用 <code className="font-mono">/v1/messages</code>。</p>
        </section>

        <dl className="space-y-4">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">ANTHROPIC_BASE_URL</dt>
            <dd><code aria-label="ANTHROPIC_BASE_URL 配置值" className="mt-2 block break-all border border-border bg-bg-surface p-3 text-xs text-text-primary">{baseUrl}</code></dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">ANTHROPIC_AUTH_TOKEN</dt>
            <dd><code aria-label="ANTHROPIC_AUTH_TOKEN 配置值" className="mt-2 block break-all border border-warning/50 bg-bg-surface p-3 text-xs text-text-primary">{plaintextKey}</code></dd>
            <button type="button" onClick={() => void copy(plaintextKey, "Token")} className="mt-2 min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface">复制 Token</button>
          </div>
        </dl>

        <section>
          <p className="text-xs font-semibold text-text-secondary">完整环境配置</p>
          <pre aria-label="Anthropic 完整环境配置" className="mt-2 max-w-full whitespace-pre-wrap break-all border border-border bg-bg-surface p-3 font-mono text-xs leading-6 text-text-primary">{environment}</pre>
          <button type="button" onClick={() => void copy(environment, "完整配置")} className="mt-2 min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface">复制完整配置</button>
        </section>

        <p className="text-xs leading-5 text-text-secondary">撤销 Key 后，使用该 Token 的新请求将返回鉴权失败；历史请求、Usage 和审计记录继续保留。</p>
        <p className="min-h-5 text-xs font-semibold text-success" role="status" aria-live="polite">{copyStatus}</p>
      </div>
    </section>
  );
}
