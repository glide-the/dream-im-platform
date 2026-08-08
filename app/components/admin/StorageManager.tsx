"use client";

import { FormEvent, useState } from "react";
import { useCan } from "@refinedev/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type StorageObject = {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt?: string;
  driver: string;
};

type StorageList = {
  data: StorageObject[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; truncated: boolean };
  capability: { driver: string; configured: boolean; listSupported: boolean; error?: string; solution?: string };
};

function encodedKey(key: string) {
  const bytes = new TextEncoder().encode(key);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function readableBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => undefined);
  return body?.error?.message ?? fallback;
}

export default function StorageManager() {
  const queryClient = useQueryClient();
  const uploadAccess = useCan({ resource: "storage-resources", action: "create" });
  const deleteAccess = useCan({ resource: "storage-resources", action: "delete" });
  const [page, setPage] = useState(1);
  const [draftQuery, setDraftQuery] = useState("");
  const [queryText, setQueryText] = useState("");
  const [mime, setMime] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const query = useQuery<StorageList>({
    queryKey: ["admin-storage-resources", page, queryText, mime],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", sort: "uploadedAt", order: "desc" });
      if (queryText) params.set("q", queryText);
      if (mime) params.set("mime", mime);
      const response = await fetch(`/api/admin/storage-resources?${params}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(await errorMessage(response, "文件列表读取失败"));
      return await response.json() as StorageList;
    },
  });

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setMessage("");
    const response = await fetch("/api/admin/storage-resources", { method: "POST", body: new FormData(formElement) });
    if (!response.ok) {
      setMessage(await errorMessage(response, "上传失败，请检查文件和 Storage 配置后重试。"));
      setPending(false);
      return;
    }
    formElement.reset();
    setMessage("文件已上传，操作已写入审计日志。");
    setPending(false);
    await queryClient.invalidateQueries({ queryKey: ["admin-storage-resources"] });
  }

  async function remove(file: StorageObject) {
    const confirmation = window.prompt(`删除后无法从控制台恢复。请输入完整对象 Key 以确认：\n${file.key}`);
    if (confirmation !== file.key) {
      setMessage("Key 不匹配，已取消删除。");
      return;
    }
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/admin/storage-resources/${encodedKey(file.key)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmKey: confirmation }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, "删除失败，请刷新列表后重试。"));
      setPending(false);
      return;
    }
    setMessage("文件已删除，操作已写入审计日志。");
    setPending(false);
    await queryClient.invalidateQueries({ queryKey: ["admin-storage-resources"] });
  }

  const capability = query.data?.capability;
  const objects = query.data?.data ?? [];
  const pages = Math.max(1, query.data?.meta.totalPages ?? 1);

  return <div className="space-y-6">
    <section className="admin-panel grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)] sm:p-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Protected storage operations</p>
        <h2 className="mt-2 font-display text-xl font-semibold">文件上传</h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">单文件最大 25 MB。上传、删除均要求管理员权限、同源请求并记录审计。</p>
        <form onSubmit={upload} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1 text-xs font-semibold text-text-secondary">选择文件
            <input className="admin-field mt-2 block cursor-pointer text-sm" type="file" name="file" required />
          </label>
          {uploadAccess.data?.can ? <button disabled={pending || capability?.configured === false} className="min-h-11 shrink-0 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-40">{pending ? "处理中…" : "上传文件"}</button> : null}
        </form>
        {message ? <p className="mt-4 border border-border bg-bg-secondary/45 p-3 text-sm text-text-secondary" role="status">{message}</p> : null}
      </div>
      <dl className="divide-y divide-border border-y border-border text-sm">
        <div className="flex justify-between gap-4 py-3"><dt className="text-text-tertiary">Driver</dt><dd className="font-mono">{capability?.driver ?? "—"}</dd></div>
        <div className="flex justify-between gap-4 py-3"><dt className="text-text-tertiary">配置</dt><dd className={capability?.configured ? "text-success" : "text-danger"}>{capability?.configured ? "可用" : "不可用"}</dd></div>
        <div className="flex justify-between gap-4 py-3"><dt className="text-text-tertiary">列表能力</dt><dd>{capability?.listSupported ? "支持" : "不支持"}</dd></div>
        {query.data?.meta.truncated ? <div className="py-3 text-warning">对象超过查询上限，请使用 Key 搜索缩小范围。</div> : null}
      </dl>
    </section>

    <section className="admin-panel min-w-0 overflow-hidden">
      <header className="border-b border-border p-4 sm:p-5">
        <h2 className="font-display text-xl font-semibold">文件列表</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-[minmax(220px,1fr)_200px_auto]" onSubmit={(event) => { event.preventDefault(); setQueryText(draftQuery.trim()); setPage(1); }}>
          <label className="text-xs font-semibold text-text-secondary">对象 Key 或文件名<input className="admin-field mt-1 block text-sm" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="搜索对象" /></label>
          <label className="text-xs font-semibold text-text-secondary">文件类型<select className="admin-field mt-1 block text-sm" value={mime} onChange={(event) => { setMime(event.target.value); setPage(1); }}><option value="">全部</option><option value="image/">图片</option><option value="video/">视频</option><option value="audio/">音频</option><option value="application/pdf">PDF</option><option value="text/">文本</option></select></label>
          <button type="submit" className="min-h-11 self-end bg-text-primary px-5 text-sm font-semibold text-bg-surface">筛选</button>
        </form>
      </header>
      {query.error ? <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert"><p className="font-semibold">文件资源暂时不可用</p><p className="mt-1">{query.error.message}</p><button type="button" onClick={() => query.refetch()} className="mt-3 min-h-10 underline">重新加载</button></div> : null}
      <div className="max-w-full overflow-x-auto">
        <table className="min-w-[860px] w-full text-left text-sm">
          <thead><tr className="border-b border-border bg-bg-secondary/45">{["文件", "MIME Type", "大小", "上传时间", "操作"].map((label) => <th key={label} className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{label}</th>)}</tr></thead>
          <tbody>
            {query.isLoading ? <tr><td colSpan={5} className="px-4 py-12 text-center text-text-tertiary">正在读取文件…</td></tr> : null}
            {!query.isLoading && !query.error && objects.length === 0 ? <tr><td colSpan={5} className="px-4 py-14 text-center"><p className="font-display text-lg font-semibold">暂无文件</p><p className="mt-2 text-sm text-text-tertiary">调整筛选条件，或上传第一个资源。</p></td></tr> : null}
            {objects.map((file) => {
              const base = `/api/admin/storage-resources/${encodedKey(file.key)}`;
              return <tr key={file.key} className="border-b border-border last:border-0 hover:bg-bg-secondary/35">
                <td className="max-w-[360px] px-4 py-3"><p className="truncate font-semibold" title={file.filename}>{file.filename}</p><p className="mt-1 truncate font-mono text-[10px] text-text-tertiary" title={file.key}>{file.key}</p></td>
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">{file.contentType}</td>
                <td className="px-4 py-3 text-text-secondary">{readableBytes(file.size)}</td>
                <td className="px-4 py-3 text-text-secondary">{file.uploadedAt ? new Date(file.uploadedAt).toLocaleString("zh-CN") : "—"}</td>
                <td className="px-4 py-3"><div className="flex items-center gap-3 whitespace-nowrap"><a href={`${base}?mode=preview`} target="_blank" rel="noreferrer" className="min-h-10 py-2 text-xs font-semibold underline decoration-border">预览</a><a href={`${base}?mode=download`} className="min-h-10 py-2 text-xs font-semibold underline decoration-border">下载</a>{deleteAccess.data?.can ? <button type="button" disabled={pending} onClick={() => remove(file)} className="min-h-10 py-2 text-xs font-semibold text-danger underline decoration-danger/30 disabled:opacity-40">删除</button> : null}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-4 py-4"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">上一页</button><span className="font-mono text-[10px] text-text-tertiary">第 {page} / {pages} 页 · {query.data?.meta.total ?? 0} 个对象</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">下一页</button></footer>
    </section>
  </div>;
}
