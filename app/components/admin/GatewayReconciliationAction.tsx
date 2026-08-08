"use client";

import { useInvalidate, useList, usePermissions } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";

type ReconciliationMode = "release_unbilled" | "settle_known_usage";
type RequestRecord = Record<string, unknown>;
type TokenValues = {
  inputTokens: string;
  outputTokens: string;
  cacheReadTokens: string;
  cacheWriteTokens: string;
};

const inputClass =
  "admin-field min-h-11 w-full text-sm outline-none focus:border-accent";

const emptyTokens: TokenValues = {
  inputTokens: "",
  outputTokens: "",
  cacheReadTokens: "",
  cacheWriteTokens: "",
};

const tokenFields: Array<{ key: keyof TokenValues; source: string; label: string }> = [
  { key: "inputTokens", source: "input_tokens", label: "Input tokens" },
  { key: "outputTokens", source: "output_tokens", label: "Output tokens" },
  { key: "cacheReadTokens", source: "cache_read_tokens", label: "Cache read tokens" },
  { key: "cacheWriteTokens", source: "cache_write_tokens", label: "Cache write tokens" },
];

function tokenValuesFromRequest(record: RequestRecord): TokenValues {
  return Object.fromEntries(
    tokenFields.map((field) => [
      field.key,
      record[field.source] === null || record[field.source] === undefined
        ? ""
        : String(record[field.source]),
    ]),
  ) as TokenValues;
}

function display(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function FrozenContext({ record }: { record: RequestRecord }) {
  const rows = [
    ["用户", record.email],
    ["Provider / Model", `${display(record.provider_code)} / ${display(record.model_code)}`],
    ["请求模型", record.requested_model],
    ["状态 / 结果", `${display(record.status)} / ${display(record.outcome)}`],
    ["Token 口径", record.input_token_semantics],
    ["预留 micro-USD", record.reserved_microusd],
    ["Input 价格快照", record.input_price_snapshot],
    ["Output 价格快照", record.output_price_snapshot],
    ["Cache read 快照", record.cache_read_price_snapshot],
    ["Cache write 快照", record.cache_write_price_snapshot],
    ["错误代码", record.error_code],
    ["错误信息", record.error_message],
    ["发生时间", record.created_at ? new Date(String(record.created_at)).toLocaleString("zh-CN") : "—"],
  ];
  return (
    <section className="border border-border bg-bg-surface p-4" aria-label="冻结请求上下文">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold">冻结请求上下文</h3>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">提交前会再次读取并校验 settlement_failed；最终金额由服务端在事务中使用以下价格快照计算。</p>
        </div>
        <span className="border border-danger/35 bg-danger-light px-2 py-1 text-xs font-semibold text-danger">{display(record.status)}</span>
      </div>
      <dl className="mt-4 grid gap-x-5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={String(label)} className="border-t border-border py-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{String(label)}</dt>
            <dd className="mt-1 break-words font-mono text-xs leading-5 text-text-secondary">{display(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function GatewayReconciliationAction() {
  const permissions = usePermissions<string[]>({});
  const invalidate = useInvalidate();
  const failedRequests = useList<RequestRecord>({
    resource: "gateway-requests",
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: [{ field: "status", operator: "eq", value: "settlement_failed" }],
  });
  const [requestId, setRequestId] = useState("");
  const [requestRecord, setRequestRecord] = useState<RequestRecord | null>(null);
  const [mode, setMode] = useState<ReconciliationMode>("settle_known_usage");
  const [tokens, setTokens] = useState<TokenValues>(emptyTokens);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const expectedConfirmation =
    mode === "release_unbilled" ? "RELEASE_UNBILLED" : "SETTLE_KNOWN_USAGE";
  const selectedOption = useMemo(
    () => failedRequests.result.data.find((record) => String(record.id) === requestId),
    [failedRequests.result.data, requestId],
  );

  useEffect(() => {
    const deepLinkedId = new URLSearchParams(window.location.search).get("requestId");
    if (deepLinkedId) setRequestId(deepLinkedId);
  }, []);

  useEffect(() => {
    if (!requestId) {
      setRequestRecord(null);
      setTokens(emptyTokens);
      return;
    }
    let cancelled = false;
    setLoadingRecord(true);
    setError("");
    fetch(`/api/admin/gateway-requests/${encodeURIComponent(requestId)}`, {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.data) {
          throw new Error(body?.error?.message ?? `请求读取失败（HTTP ${response.status}）`);
        }
        if (body.data.status !== "settlement_failed") {
          throw new Error("该请求已不在 settlement_failed 状态，请刷新队列后重新选择。");
        }
        if (!cancelled) {
          setRequestRecord(body.data);
          setTokens(tokenValuesFromRequest(body.data));
        }
      })
      .catch((reasonValue) => {
        if (!cancelled) {
          setRequestRecord(null);
          setError(reasonValue instanceof Error ? reasonValue.message : "请求上下文加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRecord(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestRecord || String(requestRecord.id) !== requestId) {
      setError("请先选择并成功加载一条 settlement_failed 请求。");
      return;
    }
    if (mode === "settle_known_usage" && tokenFields.some((field) => tokens[field.key] === "")) {
      setError("按已知 Token 结算时，四类 Token 都必须经人工核对后填写；未知值不会自动当作 0。");
      return;
    }
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const latestResponse = await fetch(
        `/api/admin/gateway-requests/${encodeURIComponent(requestId)}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      const latest = await latestResponse.json().catch(() => ({}));
      if (!latestResponse.ok || latest.data?.status !== "settlement_failed") {
        throw new Error("请求状态已变化，未执行结算；请刷新上下文后重试。");
      }
      const response = await fetch(
        `/api/admin/gateway-requests/${encodeURIComponent(requestId)}/reconcile`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            confirmation,
            reason,
            ...(mode === "settle_known_usage"
              ? Object.fromEntries(
                  tokenFields.map((field) => [field.key, Number(tokens[field.key])]),
                )
              : {}),
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error?.message ?? `对账失败（HTTP ${response.status}）`);
      }
      await Promise.all(
        ["gateway-requests", "usage", "ledger", "billing-accounts"].map((resource) =>
          invalidate({ resource, invalidates: ["list", "detail"] }),
        ),
      );
      setMessage(`请求 ${requestId} 已完成受控结算；账本、配额与审计已原子更新。`);
      setRequestId("");
      setRequestRecord(null);
      setTokens(emptyTokens);
      setReason("");
      setConfirmation("");
      await failedRequests.query.refetch();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "对账服务暂时不可用");
    } finally {
      setSubmitting(false);
    }
  }

  if (!permissions.data?.includes("billing.adjust")) return null;

  return (
    <section className="border border-accent-orange bg-accent-orange-light/25 p-5 sm:p-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-tertiary">Settlement exception workstation</p>
        <h2 className="mt-2 font-display text-xl font-semibold text-text-primary">人工处置 settlement_failed</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">从真实异常队列选择请求。释放模式仅用于已证明上游未产生用量；已知用量模式必须逐项填写核对值。</p>
      </header>

      <form className="mt-5 space-y-5" onSubmit={submit}>
        <label className="block text-xs font-semibold text-text-secondary">
          待核对 Gateway Request *
          <select className={`${inputClass} mt-2 font-mono text-xs`} value={requestId} onChange={(event) => { setRequestId(event.target.value); setConfirmation(""); setMessage(""); }} required disabled={failedRequests.query.isLoading || submitting}>
            <option value="">{failedRequests.query.isLoading ? "正在加载异常队列…" : "选择 settlement_failed 请求"}</option>
            {failedRequests.result.data.map((record) => (
              <option key={String(record.id)} value={String(record.id)}>
                {display(record.email)} · {display(record.provider_code)}/{display(record.requested_model)} · {new Date(String(record.created_at)).toLocaleString("zh-CN")}
              </option>
            ))}
            {requestId && !selectedOption ? <option value={requestId}>{requestId}（深链请求）</option> : null}
          </select>
        </label>
        {failedRequests.query.error ? <p className="text-sm text-danger" role="alert">异常队列加载失败：{failedRequests.query.error.message}</p> : null}
        {loadingRecord ? <div className="space-y-3" aria-label="正在加载冻结请求上下文"><span className="block h-5 w-2/3 animate-pulse bg-bg-secondary" /><span className="block h-40 animate-pulse bg-bg-secondary" /></div> : requestRecord ? <FrozenContext record={requestRecord} /> : null}

        <fieldset disabled={!requestRecord || submitting} className="grid gap-4 disabled:opacity-60 lg:grid-cols-2">
          <label className="text-xs font-semibold text-text-secondary">
            处置方式 *
            <select className={`${inputClass} mt-2`} value={mode} onChange={(event) => { setMode(event.target.value as ReconciliationMode); setConfirmation(""); }}>
              <option value="settle_known_usage">按已知 Token 结算</option>
              <option value="release_unbilled">确认无用量并释放</option>
            </select>
          </label>
          <div className="border border-border bg-bg-surface p-3 text-xs leading-5 text-text-secondary">
            <p className="font-semibold text-text-primary">影响说明</p>
            <p className="mt-1">{mode === "release_unbilled" ? "Token 统一按 0 处理并释放预留；必须附上无上游用量证据。" : "按冻结价格快照计算实际费用并追加不可变账本；界面不伪算最终金额。"}</p>
          </div>
          {tokenFields.map((field) => (
            <label key={field.key} className="text-xs font-semibold text-text-secondary">
              {field.label}{mode === "settle_known_usage" ? " *" : ""}
              <input className={`${inputClass} mt-2 font-mono`} type="number" min="0" step="1" value={tokens[field.key]} onChange={(event) => setTokens((current) => ({ ...current, [field.key]: event.target.value }))} disabled={mode === "release_unbilled"} required={mode === "settle_known_usage"} placeholder="人工核对后填写；未知不可留空提交" />
            </label>
          ))}
          <label className="text-xs font-semibold text-text-secondary lg:col-span-2">
            对账证据与处置原因 *
            <textarea className={`${inputClass} mt-2 min-h-28 py-3`} value={reason} onChange={(event) => setReason(event.target.value)} minLength={12} maxLength={1000} placeholder="至少 12 字：上游账单、请求日志、工单或人工核对结论" required />
          </label>
          <label className="text-xs font-semibold text-text-secondary lg:col-span-2">
            输入 <code className="font-mono text-text-primary">{expectedConfirmation}</code> 确认 *
            <input className={`${inputClass} mt-2 font-mono`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required pattern={expectedConfirmation} />
          </label>
        </fieldset>
        {error ? <div className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</div> : null}
        {message ? <div className="border border-success/35 bg-success-light p-4 text-sm text-success" role="status">{message}</div> : null}
        <button type="submit" disabled={submitting || !requestRecord} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">
          {submitting ? "正在锁定并结算…" : "执行受控对账"}
        </button>
      </form>
    </section>
  );
}
