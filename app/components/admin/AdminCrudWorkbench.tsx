"use client";

import { useCan, useInvalidate } from "@refinedev/core";
import { FormEvent, useMemo, useState } from "react";

type Operation = "create" | "update" | "delete";

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
  const [payload, setPayload] = useState(() =>
    JSON.stringify(createTemplate, null, 2),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [state, setState] = useState<{
    pending: boolean;
    error?: string;
    success?: string;
  }>({ pending: false });

  const template = useMemo(
    () => (operation === "update" ? (updateTemplate ?? {}) : createTemplate),
    [createTemplate, operation, updateTemplate],
  );

  function changeOperation(next: Operation) {
    setOperation(next);
    setState({ pending: false });
    setConfirmDelete(false);
    if (next !== "delete") {
      setPayload(
        JSON.stringify(
          next === "update" ? (updateTemplate ?? {}) : createTemplate,
          null,
          2,
        ),
      );
    }
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
        body = JSON.stringify(JSON.parse(payload));
      } catch {
        setState({ pending: false, error: "JSON 内容格式不正确。" });
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
    const result = (await response.json().catch(() => ({}))) as {
      data?: { id?: string };
      error?: { message?: string };
    };
    if (!response.ok) {
      setState({
        pending: false,
        error: result.error?.message ?? `操作失败（HTTP ${response.status}）`,
      });
      return;
    }
    await invalidate({ resource, invalidates: ["list", "detail"] });
    setState({
      pending: false,
      success: `${operation === "create" ? "创建" : operation === "update" ? "更新" : "删除"}成功：${result.data?.id ?? recordId}`,
    });
    if (operation === "create" && result.data?.id) setRecordId(result.data.id);
  }

  if (!access.data?.can) return null;

  return (
    <section className="rounded-[24px] border border-border bg-bg-surface p-5 shadow-subtle sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">CRUD workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>
        </div>
        <code className="rounded-lg bg-bg-secondary px-3 py-2 text-[11px] text-text-tertiary">{resource}</code>
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
        <div>
          <label className="text-xs font-semibold text-text-secondary" htmlFor={`${resource}-operation`}>操作</label>
          <select
            id={`${resource}-operation`}
            value={operation}
            onChange={(event) => changeOperation(event.target.value as Operation)}
            className="mt-2 min-h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-sm"
          >
            <option value="create">创建</option>
            <option value="update">更新</option>
            {allowDelete ? <option value="delete">永久删除</option> : null}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-text-secondary" htmlFor={`${resource}-id`}>记录 ID</label>
          <input
            id={`${resource}-id`}
            value={recordId}
            onChange={(event) => setRecordId(event.target.value)}
            disabled={operation === "create"}
            placeholder={operation === "create" ? "创建后自动返回" : "从下方列表复制 ID"}
            className="mt-2 min-h-11 w-full rounded-xl border border-border bg-bg-primary px-3 font-mono text-xs disabled:opacity-55"
          />
        </div>
        <button
          type="submit"
          disabled={state.pending}
          className="min-h-11 rounded-xl bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50"
        >
          {state.pending ? "处理中…" : "执行操作"}
        </button>

        {operation !== "delete" ? (
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-text-secondary" htmlFor={`${resource}-payload`}>JSON 字段</label>
              <button
                type="button"
                onClick={() => setPayload(JSON.stringify(template, null, 2))}
                className="text-xs font-semibold text-accent"
              >
                恢复模板
              </button>
            </div>
            <textarea
              id={`${resource}-payload`}
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              rows={9}
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-border bg-bg-primary p-4 font-mono text-xs leading-6 text-text-primary"
            />
          </div>
        ) : (
          <label className="flex min-h-12 items-center gap-3 rounded-xl bg-danger-light px-4 text-sm text-danger lg:col-span-3">
            <input
              type="checkbox"
              checked={confirmDelete}
              onChange={(event) => setConfirmDelete(event.target.checked)}
            />
            我确认永久删除该记录；外键依赖可能阻止此操作。
          </label>
        )}
      </form>

      {state.error ? <p className="mt-4 rounded-xl bg-danger-light p-3 text-sm text-danger">{state.error}</p> : null}
      {state.success ? <p className="mt-4 rounded-xl bg-success-light p-3 text-sm text-success">{state.success}</p> : null}
    </section>
  );
}
