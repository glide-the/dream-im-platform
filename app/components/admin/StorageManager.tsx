"use client";

import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type StorageStatus = { type: string; supportsDirectUpload: boolean; isConfigured: boolean; error?: string; solution?: string };

export default function StorageManager() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ key: string; url: string } | null>(null);
  const [pending, setPending] = useState(false);
  const query = useQuery({ queryKey: ["storage-status"], queryFn: async () => { const response = await fetch("/api/storage", { headers: { accept: "application/json" } }); const body = await response.json(); if (!response.ok) throw new Error("Storage 状态读取失败"); return body as StorageStatus; } });

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setMessage("");
    const response = await fetch("/api/storage/upload", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { setMessage(body?.error ?? "上传失败"); return; }
    setResult({ key: body.key, url: body.url });
    setMessage("资源已上传。保存返回的 Storage Key，业务数据应引用 Key 而不是临时签名 URL。");
    formElement.reset();
  }

  const status = query.data;
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]"><section className="admin-panel p-5 sm:p-6"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Driver status</p><h2 className="mt-2 font-display text-xl font-semibold">Storage 配置</h2>{query.error ? <p className="mt-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger">{query.error.message}</p> : <dl className="mt-5 divide-y divide-border border-y border-border text-sm"><div className="flex justify-between gap-4 py-4"><dt className="text-text-tertiary">Driver</dt><dd className="font-mono">{status?.type ?? "—"}</dd></div><div className="flex justify-between gap-4 py-4"><dt className="text-text-tertiary">配置状态</dt><dd className={status?.isConfigured ? "text-success" : "text-danger"}>{status?.isConfigured ? "可用" : "不可用"}</dd></div><div className="flex justify-between gap-4 py-4"><dt className="text-text-tertiary">直传能力</dt><dd>{status?.supportsDirectUpload ? "支持" : "不支持"}</dd></div></dl>}{status?.error ? <div className="mt-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger"><p className="font-semibold">{status.error}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5">{status.solution}</p></div> : null}</section><section className="admin-panel p-5 sm:p-6"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Resource upload</p><h2 className="mt-2 font-display text-xl font-semibold">上传资源</h2><p className="mt-2 text-sm leading-6 text-text-secondary">沿用现有 app/api/storage 与 app/lib/file-storage 实现；文件内容不会进入 PostgreSQL。</p><form onSubmit={upload} className="mt-5"><label className="block text-xs font-semibold text-text-secondary">选择文件<input className="admin-field mt-2 block cursor-pointer text-sm" type="file" name="file" required /></label><button disabled={pending || !status?.isConfigured} className="mt-4 min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-40">{pending ? "上传中…" : "上传到 Storage"}</button></form>{message ? <p className="mt-4 text-sm leading-6 text-text-secondary" role="status">{message}</p> : null}{result ? <dl className="mt-4 border border-border bg-bg-secondary/45 p-4 text-xs"><dt className="font-semibold">Storage Key</dt><dd className="mt-1 break-all font-mono">{result.key}</dd><dt className="mt-3 font-semibold">受控访问 URL</dt><dd className="mt-1 break-all font-mono">{result.url}</dd></dl> : null}</section></div>;
}
