"use client";

import { useInvalidate } from "@refinedev/core";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AdminFieldDefinition,
  type FormValues,
  FieldControl,
  buildPayload,
  valuesFromRecord,
} from "./AdminResourceManager";

type Section = { id: string; title: string; description?: string };
type Preset = {
  label: string;
  description: string;
  values: Record<string, unknown>;
};

type AdminResourceFormPageProps = {
  mode: "create" | "edit";
  resource: string;
  recordId?: string;
  seedRecordId?: string;
  seedOverrides?: Record<string, unknown>;
  title: string;
  eyebrow: string;
  description: string;
  backHref: string;
  fields: AdminFieldDefinition[];
  sections: Section[];
  defaults?: Record<string, unknown>;
  presets?: Preset[];
  submitLabel: string;
  context?: ReactNode | ((values: FormValues) => ReactNode);
};

type ApiResult = {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: unknown };
};

const EMPTY_FORM_DEFAULTS: Record<string, unknown> = {};
const EMPTY_FORM_OVERRIDES: Record<string, unknown> = {};
const EMPTY_FORM_PRESETS: Preset[] = [];

function HighRiskConfirmation({
  kind,
  record,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: "provider" | "model";
  record?: Record<string, unknown>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const provider = kind === "provider";
  return <dialog ref={ref} className="admin-dialog admin-dialog--modal" onCancel={(event) => { event.preventDefault(); onCancel(); }}><div className="admin-dialog-frame"><header className="admin-dialog-header"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-danger">High risk configuration</p><h2 className="mt-2 font-display text-2xl font-semibold">确认停用{provider ? " Provider" : "模型"}</h2></div><button type="button" onClick={onCancel} className="min-h-11 border border-border px-4 text-sm">关闭</button></header><div className="admin-dialog-body space-y-4"><p className="text-sm leading-6 text-text-secondary">{provider ? "停用后，新代理请求不能再通过该 Provider 解析；历史请求、Usage、价格快照与 Ledger 不受影响。" : "停用后，外部服务不能再通过该 alias 发起新请求；历史请求和计费事实保持只读。"}</p>{provider ? <dl className="grid grid-cols-2 border-l border-t border-border"><div className="border-b border-r border-border p-4"><dt className="text-xs text-text-tertiary">关联启用模型</dt><dd className="mt-2 font-mono text-lg font-semibold">{Number(record?.enabled_model_count ?? 0).toLocaleString("zh-CN")}</dd></div><div className="border-b border-r border-border p-4"><dt className="text-xs text-text-tertiary">近 24h 请求</dt><dd className="mt-2 font-mono text-lg font-semibold">{Number(record?.request_count_24h ?? 0).toLocaleString("zh-CN")}</dd></div></dl> : null}<p className="border border-warning/40 bg-accent-orange-light p-4 text-xs leading-5 text-text-secondary">该操作可通过重新启用恢复，但恢复前仍需重新满足 Credential、Pricing、权限、余额与 Gateway Key Scope。</p></div><footer className="admin-dialog-footer"><button type="button" onClick={onCancel} className="min-h-11 border border-border px-4 text-sm">取消</button><button type="button" disabled={pending} onClick={onConfirm} className="min-h-11 bg-danger px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "保存中…" : "确认停用并保存"}</button></footer></div></dialog>;
}

export default function AdminResourceFormPage({
  mode,
  resource,
  recordId,
  seedRecordId,
  seedOverrides,
  title,
  eyebrow,
  description,
  backHref,
  fields,
  sections,
  defaults,
  presets,
  submitLabel,
  context,
}: AdminResourceFormPageProps) {
  const resolvedDefaults = defaults ?? EMPTY_FORM_DEFAULTS;
  const resolvedOverrides = seedOverrides ?? EMPTY_FORM_OVERRIDES;
  const resolvedPresets = presets ?? EMPTY_FORM_PRESETS;
  const router = useRouter();
  const invalidate = useInvalidate();
  const [record, setRecord] = useState<Record<string, unknown> | undefined>();
  const [values, setValues] = useState<FormValues>(() =>
    valuesFromRecord(fields, undefined, resolvedDefaults, "create"),
  );
  const [initialValues, setInitialValues] = useState<FormValues>(() =>
    valuesFromRecord(fields, undefined, resolvedDefaults, "create"),
  );
  const [loading, setLoading] = useState(
    mode === "edit" || Boolean(seedRecordId),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [confirmation, setConfirmation] = useState<"provider" | "model" | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues),
    [initialValues, values],
  );

  useEffect(() => {
    const targetId = mode === "edit" ? recordId : seedRecordId;
    if (!targetId) return;
    if (mode === "edit" && !recordId) {
      setError("缺少要编辑的记录 ID。");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/admin/${resource}/${encodeURIComponent(targetId)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ApiResult;
        if (!response.ok || !body.data) {
          throw new Error(
            body.error?.message ?? `记录加载失败（HTTP ${response.status}）`,
          );
        }
        const next = valuesFromRecord(fields, body.data, {
          ...resolvedDefaults,
          ...(mode === "create"
            ? { replacesPricingRuleId: seedRecordId }
            : {}),
        }, mode);
        if (mode === "create") {
          const overrides = valuesFromRecord(
            fields,
            undefined,
            resolvedOverrides,
            "create",
          );
          for (const key of Object.keys(resolvedOverrides)) {
            next[key] = overrides[key];
          }
        }
        setRecord(body.data);
        setValues(next);
        setInitialValues(next);
        setRequestId(response.headers.get("x-request-id") ?? "");
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "记录加载失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fields, mode, recordId, resource, resolvedDefaults, resolvedOverrides, seedRecordId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function leave() {
    if (dirty && !window.confirm("存在未保存更改，确认离开吗？")) return;
    router.push(backHref);
  }

  function applyPreset(preset: Preset) {
    setValues(
      valuesFromRecord(
        fields,
        undefined,
        { ...resolvedDefaults, ...preset.values },
        "create",
      ),
    );
  }

  async function save() {
    setPending(true);
    setError("");
    setRequestId("");
    try {
      const payload = buildPayload(fields, values, mode);
      const endpoint =
        mode === "create"
          ? `/api/admin/${resource}`
          : `/api/admin/${resource}/${encodeURIComponent(String(recordId))}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResult;
      const nextRequestId = response.headers.get("x-request-id") ?? "";
      setRequestId(nextRequestId);
      if (!response.ok || !body.data) {
        const code = body.error?.code;
        throw new Error(
          body.error?.message
            ? `${body.error.message}${code ? `（${code}）` : ""}`
            : `保存失败（HTTP ${response.status}）`,
        );
      }
      await invalidate({ resource, invalidates: ["list", "detail"] });
      setInitialValues(values);
      const savedId = String(body.data.id ?? recordId ?? "");
      if (mode === "create" && resource === "providers" && savedId) {
        const savedConfig =
          body.data.config &&
          typeof body.data.config === "object" &&
          !Array.isArray(body.data.config)
            ? (body.data.config as Record<string, unknown>)
            : {};
        if (savedConfig.modelCatalogMode === "manual") {
          const manualModel =
            typeof savedConfig.manualModel === "string"
              ? savedConfig.manualModel.trim()
              : "";
          const query = new URLSearchParams({ providerId: savedId });
          if (manualModel) query.set("upstreamModel", manualModel);
          router.push(`/admin/models/models/new?${query.toString()}`);
          router.refresh();
          return;
        }
        try {
          const discoveryResponse = await fetch(
            `/api/admin/providers/${encodeURIComponent(savedId)}/discover`,
            { method: "POST", headers: { accept: "application/json" } },
          );
          const discoveryBody = (await discoveryResponse.json().catch(() => ({}))) as ApiResult;
          const snapshotId = discoveryBody.data?.id;
          if (discoveryResponse.ok && snapshotId) {
            router.push(
              `/admin/models/providers/${encodeURIComponent(savedId)}/discover/${encodeURIComponent(String(snapshotId))}`,
            );
            router.refresh();
            return;
          }
        } catch {
          // The Provider write is already committed. Continue to the registry
          // with a visible retry action instead of resubmitting the record.
        }
        router.push(
          `${backHref}${backHref.includes("?") ? "&" : "?"}saved=${encodeURIComponent(savedId)}&discovery=failed`,
        );
        router.refresh();
        return;
      }
      router.push(
        `${backHref}${backHref.includes("?") ? "&" : "?"}saved=${encodeURIComponent(savedId)}`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "edit" && resource === "providers" && record?.status === "active" && values.status === "disabled") {
      setConfirmation("provider");
      return;
    }
    if (mode === "edit" && resource === "models" && record?.enabled === true && values.enabled === false) {
      setConfirmation("model");
      return;
    }
    await save();
  }

  return (
    <section className="admin-ai-form-page fixed inset-0 z-[80] flex min-h-[100dvh] flex-col overflow-hidden bg-bg-primary">
      <header className="z-20 shrink-0 border-b border-border bg-bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-20 max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={leave}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-bg-surface text-xl hover:bg-bg-secondary"
              aria-label="返回列表"
            >
              ←
            </button>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                {eyebrow}
              </p>
              <h1 className="mt-1 truncate font-display text-2xl font-semibold sm:text-3xl">
                {title}
              </h1>
            </div>
          </div>
          <span className="hidden border border-border px-3 py-1.5 font-mono text-[10px] text-text-tertiary sm:inline-flex">
            {mode === "create" ? "NEW CONFIG" : `EDIT · ${recordId ?? "—"}`}
          </span>
        </div>
      </header>

      <form id={`${resource}-standalone-form`} onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1180px] gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:py-10">
          <div className="min-w-0 space-y-8">
            <section className="border-b border-border pb-6">
              <p className="max-w-3xl text-sm leading-7 text-text-secondary">
                {description}
              </p>
              {record?.updated_at ? (
                <p className="mt-3 font-mono text-[10px] text-text-tertiary">
                  服务器记录更新于 {new Date(String(record.updated_at)).toLocaleString("zh-CN")}
                </p>
              ) : null}
            </section>

            {resolvedPresets.length > 0 && mode === "create" ? (
              <section aria-labelledby={`${resource}-preset-title`}>
                <h2 id={`${resource}-preset-title`} className="font-display text-xl font-semibold">
                  预设供应商
                </h2>
                <p className="mt-1 text-xs leading-5 text-text-tertiary">
                  与 cc-switch 一致：预设只填充字段，仍需检查 Endpoint、模型与凭据。
                </p>
                <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-2">
                  {resolvedPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="min-h-12 shrink-0 rounded-2xl border border-border bg-bg-secondary px-5 text-left hover:border-text-tertiary hover:bg-bg-surface"
                      title={preset.description}
                    >
                      <span className="block text-sm font-semibold">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {loading ? (
              <div className="space-y-4" aria-label="正在加载配置">
                {Array.from({ length: 5 }).map((_, index) => (
                  <span key={index} className="block h-24 animate-pulse rounded-xl border border-border bg-bg-secondary" />
                ))}
              </div>
            ) : (
              sections.map((section) => {
                const sectionFields = fields.filter((field) => {
                  if ((field.section ?? "main") !== section.id) return false;
                  if (mode === "create" && field.updateOnly) return false;
                  if (
                    mode === "edit" &&
                    field.createOnly &&
                    !field.readOnlyOnEdit
                  ) {
                    return false;
                  }
                  return true;
                });
                if (sectionFields.length === 0) return null;
                return (
                  <fieldset key={section.id} className="rounded-2xl border border-border bg-bg-surface p-5 sm:p-6">
                    <legend className="px-2 font-display text-xl font-semibold">
                      {section.title}
                    </legend>
                    {section.description ? (
                      <p className="mt-1 text-sm leading-6 text-text-secondary">
                        {section.description}
                      </p>
                    ) : null}
                    <div className="mt-5 grid gap-5 sm:grid-cols-2">
                      {sectionFields.map((field) => (
                        <FieldControl
                          key={field.key}
                          field={field}
                          value={
                            values[field.key] ??
                            (field.control === "switch" ? false : "")
                          }
                          mode={mode}
                          onChange={(next) =>
                            setValues((current) => ({
                              ...current,
                              [field.key]: next,
                            }))
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                );
              })
            )}

            {error ? (
              <div className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">
                <p className="font-semibold">配置未保存</p>
                <p className="mt-1 leading-6">{error}</p>
                {requestId ? (
                  <p className="mt-2 font-mono text-[10px]">Request ID: {requestId}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
            {typeof context === "function" ? context(values) : context}
            <section className="rounded-2xl border border-border bg-bg-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                Save impact
              </p>
              <h2 className="mt-2 font-display text-lg font-semibold">保存前检查</h2>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-text-secondary">
                <li>· Secret 只提交本次输入，历史值不会回填。</li>
                <li>· 关系字段提交真实选中 ID，服务器再次校验外键。</li>
                <li>· 409/503 会保留本页草稿和错误上下文。</li>
                <li>· 成功写入同步生成管理员审计记录。</li>
              </ul>
            </section>
          </aside>
        </div>
        </div>

        <footer className="z-20 shrink-0 border-t border-border bg-bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex min-h-20 max-w-[1180px] items-center justify-end gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={leave}
              className="min-h-11 rounded-xl border border-border bg-bg-surface px-5 text-sm font-semibold hover:bg-bg-secondary"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={pending || loading}
              className="min-h-11 rounded-xl bg-text-primary px-6 text-sm font-semibold text-bg-surface disabled:opacity-50"
            >
              {pending ? "保存中…" : submitLabel}
            </button>
          </div>
        </footer>
      </form>
      {confirmation ? <HighRiskConfirmation kind={confirmation} record={record} pending={pending} onCancel={() => setConfirmation(null)} onConfirm={() => { setConfirmation(null); void save(); }} /> : null}
    </section>
  );
}
