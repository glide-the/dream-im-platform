"use client";

import { useCan, useInvalidate } from "@refinedev/core";
import { FormEvent, useState } from "react";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "textarea" | "json" | "select";
  options?: Array<{ label: string; value: string }>;
};

export default function StorySourceEditor({
  resource,
  title,
  description,
  fields,
  reviewActions = false,
}: {
  resource: "story-workspaces" | "story-stories" | "story-characters" | "story-scenes";
  title: string;
  description: string;
  fields: Field[];
  reviewActions?: boolean;
}) {
  const access = useCan({ resource, action: "edit" });
  const invalidate = useInvalidate();
  const [id, setId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState("");
  const [state, setState] = useState<{ pending: boolean; error?: string; success?: string }>({ pending: false });

  async function call(url: string, method: "PATCH" | "POST", body: Record<string, unknown>) {
    setState({ pending: true });
    const response = await fetch(url, {
      method,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { data?: { id?: string }; error?: { message?: string } };
    if (!response.ok) {
      setState({ pending: false, error: result.error?.message ?? `操作失败（HTTP ${response.status}）` });
      return;
    }
    await invalidate({ resource, invalidates: ["list", "detail"] });
    setState({ pending: false, success: `操作成功：${result.data?.id ?? id}` });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!id.trim()) {
      setState({ pending: false, error: "请输入源业务记录 ID。" });
      return;
    }
    try {
      const payload = Object.fromEntries(
        fields.flatMap((field) => {
          const value = values[field.key];
          if (value === undefined || value === "") return [];
          if (field.type === "number") return [[field.key, Number(value)]];
          if (field.type === "json") return [[field.key, JSON.parse(value)]];
          return [[field.key, value]];
        }),
      );
      if (!Object.keys(payload).length) throw new Error("至少填写一个需要更新的字段。");
      await call(`/api/admin/${resource}/${encodeURIComponent(id.trim())}`, "PATCH", payload);
    } catch (error) {
      setState({ pending: false, error: error instanceof Error ? error.message : "表单内容无效。" });
    }
  }

  async function confirmReview() {
    if (!id.trim()) {
      setState({ pending: false, error: "请输入源业务记录 ID。" });
      return;
    }
    await call(
      `/api/admin/${resource}/${encodeURIComponent(id.trim())}/confirm`,
      "POST",
      reviewNotes.trim() ? { reviewNotes: reviewNotes.trim() } : {},
    );
  }

  if (!access.data?.can) return null;

  return (
    <section className="admin-panel p-5 sm:p-6">
      <div className="border-b border-border pb-5"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Source-safe operation</p><h2 className="mt-2 font-display text-xl font-semibold">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{description}</p></div>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-text-secondary sm:col-span-2">源业务记录 ID<input className="admin-field mt-2 block font-mono text-xs" value={id} onChange={(event) => setId(event.target.value)} placeholder="从下方真实数据列表复制 ID" /></label>
        {fields.map((field) => (
          <label key={field.key} className={`text-xs font-semibold text-text-secondary ${["textarea", "json"].includes(field.type ?? "") ? "sm:col-span-2" : ""}`}>{field.label}
            {field.type === "select" ? (
              <select className="admin-field mt-2 block text-sm" value={values[field.key] ?? ""} onChange={(event) => setValues((value) => ({ ...value, [field.key]: event.target.value }))}><option value="">不修改</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            ) : field.type === "textarea" || field.type === "json" ? (
              <textarea rows={field.type === "json" ? 5 : 4} spellCheck={field.type !== "json"} className={`admin-field mt-2 block min-h-24 text-sm ${field.type === "json" ? "font-mono text-xs" : ""}`} value={values[field.key] ?? ""} onChange={(event) => setValues((value) => ({ ...value, [field.key]: event.target.value }))} placeholder={field.type === "json" ? "只在需要修改时填写 JSON" : "留空表示不修改"} />
            ) : (
              <input type={field.type === "number" ? "number" : "text"} min={field.type === "number" ? 0 : undefined} className="admin-field mt-2 block text-sm" value={values[field.key] ?? ""} onChange={(event) => setValues((value) => ({ ...value, [field.key]: event.target.value }))} placeholder="留空表示不修改" />
            )}
          </label>
        ))}
        <div className="sm:col-span-2"><button type="submit" disabled={state.pending} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">保存允许修改的字段</button></div>
      </form>

      {reviewActions ? (
        <div className="mt-6 border-t border-border pt-5"><h3 className="text-sm font-semibold">审核确认</h3><p className="mt-1 text-xs leading-5 text-text-tertiary">确认当前待审核记录。</p><label className="mt-4 block text-xs font-semibold text-text-secondary">确认备注（可选）<textarea rows={3} maxLength={2000} className="admin-field mt-2 block min-h-20 text-sm" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={state.pending} onClick={confirmReview} className="min-h-11 border border-success/40 bg-success-light px-4 text-sm font-semibold text-success">确认</button></div></div>
      ) : null}

      {state.error ? <p className="mt-4 border border-danger/35 bg-danger-light p-3 text-sm text-danger" role="alert">{state.error}</p> : null}
      {state.success ? <p className="mt-4 border border-success/35 bg-success-light p-3 text-sm text-success" role="status">{state.success}</p> : null}
    </section>
  );
}
