"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ArtifactKind =
  | "script"
  | "episode_outline"
  | "storyboard"
  | "review_report";

type SurfaceFile = {
  kind: ArtifactKind;
  label: string;
  fileName: string;
  available: boolean;
  sizeBytes: number | null;
  updatedAt: string | null;
  revision: string | null;
};

type Surface = {
  storyId: string;
  projectId: string;
  sourceRunId: string;
  registryRevision: number;
  indexedScriptRevision: string | null;
  episodes: Array<{
    id: string;
    active: boolean;
    artifacts: SurfaceFile[];
  }>;
};

type Preview = {
  content: string;
  offset: number;
  nextOffset: number | null;
  totalBytes: number;
  truncated: boolean;
  updatedAt: string;
  revision: string;
  etag: string;
};

type ApiPayload<T> = {
  data?: T;
  error?: { code?: string; message?: string; requestId?: string };
};

const metadataFields = [
  ["title", "Story 标题"],
  ["id", "Story ID"],
  ["workspace_name", "Workspace"],
  ["workspace_id", "Workspace ID"],
  ["author_label", "作者"],
  ["author_id", "作者 ID"],
  ["source_project_id", "Project identity"],
  ["source_run_id", "Source Run"],
  ["episode_count", "Episode 数"],
  ["artifact_manifest_revision", "Manifest revision"],
  ["script_revision", "Script revision"],
  ["artifact_sync_status", "Artifact 状态"],
  ["artifact_indexed_at", "最近索引"],
  ["artifact_sync_error_code", "同步错误码"],
  ["script_size_bytes", "Script bytes"],
  ["artifact_available", "Artifact 可用"],
  ["reconcile_version", "Reconcile version"],
  ["reviewed_script_revision", "已审核 revision"],
  ["review_status", "审核状态"],
  ["status", "业务状态"],
  ["updated_at", "更新时间"],
] as const;

function shortRevision(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return text ? `${text.slice(0, 15)}…${text.slice(-6)}` : "—";
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString("zh-CN");
  }
  return String(value);
}

function statusTone(status: unknown) {
  if (["indexed", "confirmed", "published"].includes(String(status))) {
    return "border-success/35 bg-success-light text-success";
  }
  if (["failed", "missing", "rejected"].includes(String(status))) {
    return "border-danger/35 bg-danger-light text-danger";
  }
  return "border-warning/40 bg-accent-orange-light text-text-primary";
}

function errorLabel(status: number, code?: string) {
  if (status === 401) return "登录状态已失效";
  if (status === 403) return "没有 Story Artifact 读取权限";
  if (status === 404) return "Artifact 或绑定文件不存在";
  if (status === 409) return "Artifact revision 已变化";
  if (status === 413) return "文件或读取片段超过安全上限";
  if (status === 422) return "Artifact registry / manifest 合同无效";
  if (status === 503) return "共享 Artifact 文件系统不可用";
  return code ? `Artifact 读取失败（${code}）` : "Artifact 读取失败";
}

export default function StoryArtifactDetail({
  record,
}: {
  record: Record<string, unknown>;
}) {
  const storyId = String(record.id ?? "");
  const managed = record.artifact_source_type === "dream_episode";
  const [surface, setSurface] = useState<Surface | null>(null);
  const [surfaceLoading, setSurfaceLoading] = useState(managed);
  const [surfaceError, setSurfaceError] = useState("");
  const [surfaceRequestId, setSurfaceRequestId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("script");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewRequestId, setPreviewRequestId] = useState("");
  const previewCache = useRef(new Map<string, Preview>());

  async function loadSurface(signal?: AbortSignal) {
    if (!managed) return;
    setSurfaceLoading(true);
    setSurfaceError("");
    try {
      const response = await fetch(
        `/api/admin/story-stories/${encodeURIComponent(storyId)}/artifact-surface`,
        { headers: { accept: "application/json" }, signal },
      );
      const payload = (await response.json().catch(() => ({}))) as ApiPayload<Surface>;
      if (!response.ok || !payload.data) {
        setSurfaceRequestId(payload.error?.requestId ?? response.headers.get("x-request-id") ?? "");
        throw new Error(errorLabel(response.status, payload.error?.code));
      }
      setSurface(payload.data);
      const active = payload.data.episodes.find((episode) => episode.active) ?? payload.data.episodes[0];
      setEpisodeId((current) => current || active?.id || "");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSurfaceError(error instanceof Error ? error.message : "Artifact surface 加载失败");
    } finally {
      setSurfaceLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadSurface(controller.signal);
    return () => controller.abort();
    // storyId and the source contract identify this immutable drawer scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, managed]);

  const selectedEpisode = useMemo(
    () => surface?.episodes.find((episode) => episode.id === episodeId) ?? null,
    [episodeId, surface],
  );
  const selectedArtifact = useMemo(
    () => selectedEpisode?.artifacts.find((artifact) => artifact.kind === kind) ?? null,
    [kind, selectedEpisode],
  );

  async function loadPreview(offset: number, append: boolean, signal?: AbortSignal) {
    if (!selectedArtifact?.available || !selectedArtifact.revision || !episodeId) return;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const cacheKey = `${storyId}:${episodeId}:${kind}`;
      const cached = previewCache.current.get(cacheKey);
      const params = new URLSearchParams({
        episodeId,
        kind,
        offset: String(offset),
        limit: "65536",
        revision: selectedArtifact.revision,
      });
      const response = await fetch(
        `/api/admin/story-stories/${encodeURIComponent(storyId)}/artifacts?${params}`,
        {
          headers: {
            accept: "application/json",
            ...(offset === 0 && cached ? { "if-none-match": cached.etag } : {}),
          },
          signal,
        },
      );
      if (response.status === 304 && cached) {
        setPreview(cached);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as ApiPayload<Preview>;
      if (!response.ok || !payload.data) {
        setPreviewRequestId(payload.error?.requestId ?? response.headers.get("x-request-id") ?? "");
        throw new Error(errorLabel(response.status, payload.error?.code));
      }
      setPreview((current) => {
        const next = append && current
          ? { ...payload.data!, content: current.content + payload.data!.content, offset: 0 }
          : payload.data!;
        previewCache.current.set(cacheKey, next);
        return next;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPreviewError(error instanceof Error ? error.message : "Artifact 预览加载失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    setPreview(null);
    setPreviewError("");
    if (!selectedArtifact?.available) return;
    const controller = new AbortController();
    void loadPreview(0, false, controller.signal);
    return () => controller.abort();
    // selectedArtifact revision is the preview cache and consistency key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, episodeId, kind, selectedArtifact?.revision, selectedArtifact?.available]);

  const revisionMismatch =
    kind === "script" &&
    Boolean(record.script_revision) &&
    Boolean(selectedArtifact?.revision) &&
    record.script_revision !== selectedArtifact?.revision;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2" aria-label="Story 双轨事实">
        <div className="border border-border bg-bg-secondary/45 p-4" data-testid="story-index-rail">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">PostgreSQL 索引</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`border px-2 py-1 text-xs font-semibold ${statusTone(record.artifact_sync_status)}`}>
              {displayValue(record.artifact_sync_status ?? "未接入")}
            </span>
            <span className="font-mono text-[11px] text-text-secondary" title={String(record.script_revision ?? "")}>
              {shortRevision(record.script_revision)}
            </span>
          </div>
          <p className="mt-3 text-xs text-text-tertiary">{displayValue(record.artifact_indexed_at)}</p>
        </div>
        <div className="border border-border bg-bg-surface p-4" data-testid="story-artifact-rail">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Artifact 内容</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`border px-2 py-1 text-xs font-semibold ${revisionMismatch || surfaceError ? "border-danger/35 bg-danger-light text-danger" : selectedArtifact?.available ? "border-success/35 bg-success-light text-success" : "border-border text-text-secondary"}`}>
              {surfaceLoading ? "读取中" : surfaceError ? "不可用" : selectedArtifact?.available ? "可读取" : "文件缺失"}
            </span>
            <span className="font-mono text-[11px] text-text-secondary" title={selectedArtifact?.revision ?? ""}>
              {shortRevision(selectedArtifact?.revision)}
            </span>
          </div>
          <p className="mt-3 text-xs text-text-tertiary">
            {episodeId || "—"} · {selectedArtifact?.fileName ?? "—"} · {selectedArtifact?.sizeBytes ?? 0} bytes
          </p>
        </div>
      </section>

      {revisionMismatch ? (
        <div className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert" data-testid="story-artifact-error-409">
          <p className="font-semibold">Revision 不一致</p>
          <p className="mt-1">PostgreSQL 索引与当前文件内容不同。请等待 Dream 重新物化索引后再审核。</p>
        </div>
      ) : null}

      <section>
        <h3 className="font-display text-lg font-semibold">PostgreSQL 元数据</h3>
        <dl className="mt-3 divide-y divide-border border-y border-border">
          {metadataFields.map(([key, label]) => (
            <div key={key} className="grid gap-1 py-3 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{label}</dt>
              <dd className={`min-w-0 break-words text-sm text-text-secondary ${key.includes("revision") || key.endsWith("_id") || key === "id" ? "font-mono text-[11px]" : ""}`}>
                {displayValue(record[key])}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">Artifact 逻辑结构</h3>
            <p className="mt-1 text-xs leading-5 text-text-tertiary">来自共享只读挂载；页面不会接收或显示真实文件路径。</p>
          </div>
          {managed ? (
            <button type="button" onClick={() => void loadSurface()} disabled={surfaceLoading} className="min-h-11 border border-border px-3 text-xs font-semibold disabled:opacity-50">
              {surfaceLoading ? "读取中…" : "刷新 Artifact"}
            </button>
          ) : null}
        </div>

        {!managed ? (
          <div className="mt-4 border border-border bg-bg-secondary/45 p-4 text-sm text-text-secondary">
            这是旧 Story 索引，尚未接入 Dream Episode Artifact 来源。
          </div>
        ) : surfaceLoading && !surface ? (
          <div className="mt-4 space-y-3" aria-label="正在读取 Artifact">
            <span className="block h-11 animate-pulse bg-bg-secondary" />
            <span className="block h-48 animate-pulse bg-bg-secondary" />
          </div>
        ) : surfaceError ? (
          <div className="mt-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert" data-testid="story-artifact-error-surface">
            <p className="font-semibold">{surfaceError}</p>
            <p className="mt-1 text-xs">PostgreSQL 元数据仍可用。{surfaceRequestId ? ` Request ID: ${surfaceRequestId}` : ""}</p>
          </div>
        ) : surface ? (
          <div className="mt-4 space-y-4" data-testid="story-artifact-tree">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-text-secondary">
                Episode
                <select className="admin-field mt-1 text-sm" value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>
                  {surface.episodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>{episode.id}{episode.active ? " · active" : ""}</option>
                  ))}
                </select>
              </label>
              <div className="min-w-0 border border-border bg-bg-secondary/35 p-3 text-xs text-text-secondary">
                <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Project / registry</span>
                <span className="mt-1 block break-all font-mono">{surface.projectId} · revision {surface.registryRevision}</span>
              </div>
            </div>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Artifact 文件">
              {selectedEpisode?.artifacts.map((artifact) => (
                <button
                  key={artifact.kind}
                  type="button"
                  role="tab"
                  aria-selected={kind === artifact.kind}
                  onClick={() => setKind(artifact.kind)}
                  className={`min-h-11 shrink-0 border px-3 text-xs font-semibold ${kind === artifact.kind ? "border-text-primary bg-text-primary text-bg-surface" : "border-border bg-bg-surface text-text-secondary"}`}
                >
                  {artifact.label}{artifact.available ? "" : " · 缺失"}
                </button>
              ))}
            </div>
            <div className="border border-border bg-bg-secondary/25">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs text-text-tertiary">
                <span className="font-mono">{episodeId} / {selectedArtifact?.fileName ?? "—"}</span>
                <span>{selectedArtifact?.updatedAt ? new Date(selectedArtifact.updatedAt).toLocaleString("zh-CN") : "—"}</span>
              </header>
              {!selectedArtifact?.available ? (
                <p className="p-5 text-sm text-text-secondary">该 allowlist Artifact 当前不存在；PostgreSQL 索引仍保留显示。</p>
              ) : previewError ? (
                <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert" data-testid="story-artifact-error-preview">
                  <p className="font-semibold">{previewError}</p>
                  {previewRequestId ? <p className="mt-1 font-mono text-[11px]">Request ID: {previewRequestId}</p> : null}
                </div>
              ) : previewLoading && !preview ? (
                <div className="space-y-3 p-5" aria-label="正在读取预览"><span className="block h-4 animate-pulse bg-bg-secondary" /><span className="block h-40 animate-pulse bg-bg-secondary" /></div>
              ) : preview ? (
                <div data-testid="story-artifact-preview">
                  <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-text-secondary">{preview.content}</pre>
                  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
                    <span className="font-mono text-[10px] text-text-tertiary">已读取 {preview.content.length.toLocaleString()} chars / {preview.totalBytes.toLocaleString()} bytes</span>
                    {preview.nextOffset !== null ? (
                      <button type="button" disabled={previewLoading} onClick={() => void loadPreview(preview.nextOffset!, true)} className="min-h-11 border border-border bg-bg-surface px-3 text-xs font-semibold disabled:opacity-50">
                        {previewLoading ? "读取中…" : "加载下一段"}
                      </button>
                    ) : <span className="text-xs text-success">已到文件末尾</span>}
                  </footer>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
