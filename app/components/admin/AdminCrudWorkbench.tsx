"use client";

import { useCan, useInvalidate } from "@refinedev/core";
import { FormEvent, useMemo, useState } from "react";

type Operation = "create" | "update" | "delete";

function isStructured(value: unknown) {
  return typeof value === "object" && value !== null;
}

function initialForm(template: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [
      key,
      isStructured(value) ? JSON.stringify(value, null, 2) : value,
    ]),
  );
}

function humanLabel(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

export default function AdminCrudWorkbench({
  resource,
  title,
  description,
  createTemplate,
  updateTemplate,
  allowDelete = true,
}: {
  resource: string;
  title: string;
  description: string;
  createTemplate: Record<string, unknown>;
  updateTemplate?: Record<string, unknown>;
  allowDelete?: boolean;
}) {
  const invalidate = useInvalidate();
  const access = useCan({ resource, action: "create" });
  const [operation, setOperation] = useState<Operation>("create");
  const [recordId, setRecordId] = useState("");
  const [form, setForm] = useState<Record<string, unknown>>(() => initialForm(createTemplate));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState("");
  const [state, setState] = useState<{ pending: boolean; error?: string; success?: string }>({ pending: false });

  const template = useMemo(
    () => operation === "update" ? (updateTemplate ?? {}) : createTemplate,
    [createTemplate, operation, updateTemplate],
  );

  function changeOperation(next: Operation) {
    setOperation(next);
    setState({ pending: false });
    setOneTimeSecret("");
    setConfirmDelete(false);
    if (next !== "delete") setForm(initialForm(next === "update" ? (updateTemplate ?? {}) : createTemplate));
  }

  function payloadFromForm() {
    return Object.fromEntries(
      Object.entries(template).map(([key, templateValue]) => {
        const current = form[key];
        if (isStructured(templateValue)) {
          try {
            return [key, JSON.parse(String(current ?? ""))];
          } catch {
            throw new Error(`${humanLabel(key)} 的 JSON 格式不正确。`);
          }
        }
        if (typeof templateValue === "number") return [key, Number(current)];
        if (typeof templateValue === "boolean") return [key, Boolean(current)];
        if (templateValue === null) return [key, current === "" ? null : current];
        return [key, current];
      }),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (operation !== "create" && !recordId.trim()) {
      setState({ pending: false, error: "更新或删除时必须填写记录 ID。" });
      return;
    }
    if (operation === "delete" && !confirmDelete) {
      setState({ pending: false, error: "请先确认永久删除。" });
      return;
    }
    let body: string | undefined;
    if (operation !== "delete") {
      try {
        body = JSON.stringify(payloadFromForm());
      } catch (error) {
        setState({ pending: false, error: error instanceof Error ? error.message : "表单内容无效。" });
        return;
      }
    }

    setState({ pending: true });
    const suffix = operation === "create" ? "" : `/${encodeURIComponent(recordId.trim())}`;
    const response = await fetch(`/api/admin/${resource}${suffix}`, {
      method: operation === "create" ? "POST" : operation === "update" ? "PATCH" : "DELETE",
      headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body,
    });
    const result = (await response.json().catch(() => ({}))) as { data?: { id?: string; plaintextKey?: string }; error?: { message?: string } };
    if (!response.ok) {
      setState({ pending: false, error: result.error?.message ?? `操作失败（HTTP ${response.status}）` });
      return;
    }
    await invalidate({ resource, invalidates: ["list", "detail"] });
    const secretNotice = result.data?.plaintextKey ? " 明文密钥只显示在本次响应中，请立即安全保存。" : "";
    setOneTimeSecret(result.data?.plaintextKey ?? "");
    setState({ pending: false, success: `${operation === "create" ? "创建" : operation === "update" ? "更新" : "删除"}成功：${result.data?.id ?? recordId}。${secretNotice}` });
    if (operation === "create" && result.data?.id) setRecordId(result.data.id);
  }

  if (!access.data?.can) return null;

  return (
    <section className="admin-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="max-w-3xl"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Controlled mutation</p><h2 className="mt-2 font-display text-xl font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p></div>
        <code className="border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-tertiary">{resource}</code>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold text-text-secondary">操作
            <select value={operation} onChange={(event) => changeOperation(event.target.value as Operation)} className="admin-field mt-2 block text-sm">
              <option value="create">创建</option><option value="update">更新</option>{allowDelete ? <option value="delete">永久删除</option> : null}
            </select>
          </label>
          <label className="text-xs font-semibold text-text-secondary">记录 ID
            <input value={recordId} onChange={(event) => setRecordId(event.target.value)} disabled={operation === "create"} placeholder={operation === "create" ? "创建后自动返回" : "粘贴要操作的记录 ID"} className="admin-field mt-2 block font-mono text-xs disabled:opacity-55" />
          </label>
        </div>

        {operation !== "delete" ? (
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">资源字段</legend>
            {Object.entries(template).map(([key, templateValue]) => {
              const secret = /(api.?key|password|secret)/i.test(key);
              if (typeof templateValue === "boolean") {
                return <label key={key} className="flex min-h-12 items-center gap-3 border border-border bg-bg-elevated px-3 text-sm"><input type="checkbox" checked={Boolean(form[key])} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.checked }))} /><span>{humanLabel(key)}</span></label>;
              }
              if (isStructured(templateValue)) {
                return <label key={key} className="text-xs font-semibold text-text-secondary sm:col-span-2">{humanLabel(key)} <span className="font-normal text-text-tertiary">· JSON</span><textarea rows={5} spellCheck={false} value={String(form[key] ?? "")} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))} className="admin-field mt-2 block min-h-28 font-mono text-xs leading-5" /></label>;
              }
              return <label key={key} className="text-xs font-semibold text-text-secondary">{humanLabel(key)}<input type={secret ? "password" : typeof templateValue === "number" ? "number" : "text"} value={String(form[key] ?? "")} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))} autoComplete={secret ? "new-password" : undefined} className="admin-field mt-2 block text-sm" /></label>;
            })}
          </fieldset>
        ) : (
          <label className="flex min-h-14 items-center gap-3 border border-danger/35 bg-danger-light px-4 text-sm text-danger"><input type="checkbox" checked={confirmDelete} onChange={(event) => setConfirmDelete(event.target.checked)} />我确认永久删除该记录；外键依赖可能阻止此操作。</label>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <button type="submit" disabled={state.pending} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{state.pending ? "处理中…" : "提交操作"}</button>
          {operation !== "delete" ? <button type="button" onClick={() => setForm(initialForm(template))} className="min-h-11 border border-border px-4 text-sm text-text-secondary">恢复初始值</button> : null}
        </div>
      </form>

      {state.error ? <p className="mt-4 border border-danger/35 bg-danger-light p-3 text-sm text-danger" role="alert">{state.error}</p> : null}
      {state.success ? <p className="mt-4 border border-success/35 bg-success-light p-3 text-sm text-success" role="status">{state.success}</p> : null}
      {oneTimeSecret ? <div className="mt-4 border border-warning/50 bg-accent-orange-light p-4"><p className="text-xs font-semibold">仅显示一次的 Secret</p><code className="mt-2 block break-all text-xs">{oneTimeSecret}</code><button type="button" onClick={() => navigator.clipboard.writeText(oneTimeSecret)} className="mt-3 min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface">复制</button></div> : null}
    </section>
  );
}
