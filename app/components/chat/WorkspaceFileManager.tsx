"use client";

import { useCallback, useMemo, useState } from "react";
import { useWorkspaceFiles, useWorkspaceFileUpload } from "../../hooks/useWorkspaceFiles";
import FileUploadZone from "./FileUploadZone";
import FileTreeView from "./FileTreeView";

interface WorkspaceFileManagerProps {
  conversationId: string;
  className?: string;
}

export default function WorkspaceFileManager({
  conversationId,
  className,
}: WorkspaceFileManagerProps) {
  const [isMoving, setIsMoving] = useState(false);
  const { files, isFetching, refetch, error } = useWorkspaceFiles(conversationId);
  const { upload, isUploading, error: uploadError, clearError } = useWorkspaceFileUpload(conversationId);
  const isSyncing = isFetching || isUploading || isMoving;
  const errorMessage = error instanceof Error ? error.message : undefined;

  const handleUpload = useCallback(
    async (selectedFiles: File[]) => {
      for (const file of selectedFiles) {
        await upload(file);
      }
      await refetch();
    },
    [refetch, upload],
  );

  const handleDelete = useCallback(
    async (filePath: string) => {
      if (!window.confirm(`确定删除 ${filePath} 吗？`)) return;
      try {
        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
        await fetch(`/api/storage/workspace/${conversationId}/${encodedPath}`, { method: "DELETE" });
        await refetch();
      } catch {
        // ignore
      }
    },
    [conversationId, refetch],
  );

  const handleMove = useCallback(
    async (filePath: string) => {
      const nextPath = window.prompt("输入新的文件路径（支持子目录）", filePath);
      if (!nextPath || nextPath === filePath) return;
      setIsMoving(true);
      try {
        await fetch(`/api/storage/workspace/${conversationId}/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: filePath, to: nextPath }),
        });
        await refetch();
      } finally {
        setIsMoving(false);
      }
    },
    [conversationId, refetch],
  );

  const statusLabel = useMemo(() => (isSyncing ? "Syncing" : "Ready"), [isSyncing]);
  const statusColor = isSyncing ? "text-blue-300" : "text-[#34D399]";

  return (
    <aside
      className={`flex w-full flex-col gap-4 rounded-2xl bg-[#1F2937] p-4 text-white shadow-lg md:w-[280px] ${className ?? ""}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Workspace</p>
          <h3 className="text-lg font-semibold">文件管理</h3>
        </div>
        <div className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</div>
      </div>

      <FileUploadZone onFilesSelected={handleUpload} isUploading={isUploading} />

      {(errorMessage || uploadError) && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200">
          <div className="flex items-center justify-between gap-3">
            <span>{errorMessage ?? uploadError}</span>
            <button onClick={clearError} className="text-[10px] text-red-200">关闭</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        <FileTreeView files={files} onDelete={handleDelete} onMove={handleMove} />
      </div>
    </aside>
  );
}
