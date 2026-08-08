"use client";

import { useState } from "react";
import { usePermissions } from "@refinedev/core";

const inputClass =
  "min-h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-sm outline-none focus:border-accent";

export default function GatewayReconciliationAction() {
  const permissions = usePermissions<string[]>({});
  const [mode, setMode] = useState<
    "release_unbilled" | "settle_known_usage"
  >("settle_known_usage");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setMessage("");
    try {
      const requestId = String(form.get("requestId"));
      const response = await fetch(
        `/api/admin/gateway-requests/${encodeURIComponent(requestId)}/reconcile`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            confirmation: form.get("confirmation"),
            reason: form.get("reason"),
            inputTokens: Number(form.get("inputTokens")),
            outputTokens: Number(form.get("outputTokens")),
            cacheReadTokens: Number(form.get("cacheReadTokens")),
            cacheWriteTokens: Number(form.get("cacheWriteTokens")),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setMessage(result?.error?.message ?? "对账失败");
        return;
      }
      formElement.reset();
      setMessage("请求已结算；账本、配额与审计已原子更新。刷新列表可查看终态。");
    } catch {
      setMessage("对账服务暂时不可用");
    } finally {
      setSubmitting(false);
    }
  }

  const confirmation =
    mode === "release_unbilled" ? "RELEASE_UNBILLED" : "SETTLE_KNOWN_USAGE";

  if (!permissions.data?.includes("billing.adjust")) return null;

  return (
    <details className="rounded-[24px] border border-accent-orange bg-accent-orange-light/30 p-5 sm:p-6">
      <summary className="cursor-pointer text-base font-semibold text-text-primary">
        人工处置 settlement_failed
      </summary>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
        仅在核对上游账单或日志后使用。释放模式表示已证明未产生用量；已知用量模式将按请求保存的价格快照结算。
      </p>
      <form className="mt-5 grid gap-3 lg:grid-cols-2" onSubmit={submit}>
        <input className={inputClass} name="requestId" placeholder="Gateway Request ID" required />
        <select
          className={inputClass}
          name="mode"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as typeof mode)
          }
        >
          <option value="settle_known_usage">按已知 Token 结算</option>
          <option value="release_unbilled">确认无用量并释放</option>
        </select>
        {[
          ["inputTokens", "Input tokens"],
          ["outputTokens", "Output tokens"],
          ["cacheReadTokens", "Cache read tokens"],
          ["cacheWriteTokens", "Cache write tokens"],
        ].map(([name, placeholder]) => (
          <input
            key={name}
            className={inputClass}
            name={name}
            type="number"
            min="0"
            defaultValue="0"
            disabled={mode === "release_unbilled"}
            placeholder={placeholder}
          />
        ))}
        <textarea
          className={`${inputClass} min-h-24 py-3 lg:col-span-2`}
          name="reason"
          placeholder="对账证据与处置原因（至少 12 字）"
          required
        />
        <label className="text-sm text-text-secondary lg:col-span-2">
          输入 <code className="font-mono text-text-primary">{confirmation}</code> 确认
          <input
            className={`${inputClass} mt-2 font-mono`}
            name="confirmation"
            autoComplete="off"
            required
          />
        </label>
        <button
          disabled={submitting}
          className="min-h-11 rounded-full bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50 lg:col-span-2"
        >
          {submitting ? "结算中…" : "执行受控对账"}
        </button>
      </form>
      {message ? <p role="status" className="mt-4 text-sm text-text-secondary">{message}</p> : null}
    </details>
  );
}
