"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectUploadItemsFromDrop,
  collectUploadItemsFromFileSelection,
  type WorkspaceUploadItem,
} from "../../lib/workspace-upload";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFile,
  IconFolder,
  IconLoader,
  IconPlus,
  IconTrash,
  IconX,
} from "../Icons";

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

interface FileSidebarProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

type UploadQueueUpdater = (prev: WorkspaceUploadItem[]) => WorkspaceUploadItem[];
type DownloadNoticeType = "info" | "error" | "success";

interface DownloadNotice {
  type: DownloadNoticeType;
  message: string;
}

interface FileContextMenuState {
  x: number;
  y: number;
  file: FileInfo;
}

interface DownloadErrorResponse {
  error?: string;
}

const MAX_UPLOAD_FILES = 2000;
const MAX_UPLOAD_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB
const MAX_UPLOAD_BATCH_FILES = 20;
const MAX_UPLOAD_BATCH_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MB
const UPLOAD_REQUEST_TIMEOUT_MS = 90_000;
const UPLOAD_FORCE_REFRESH_RETRY_COUNT = 4;
const UPLOAD_FORCE_REFRESH_INTERVAL_MS = 500;

const folderPickerAttributes = {
  webkitdirectory: "",
  directory: "",
} as Record<string, string>;

export function buildWorkspaceFileDownloadUrl(
  sessionId: string,
  filePath: string,
): string {
  const params = new URLSearchParams({
    sessionId,
    path: filePath,
  });
  return `/api/workspace/files/download?${params.toString()}`;
}

export function extractFilenameFromContentDisposition(
  contentDisposition: string | null,
): string | null {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename=\"([^\"]+)\"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return null;
}

export function getWorkspaceFileDownloadErrorMessage(
  responseStatus: number,
  fallbackMessage?: string,
): string {
  if (fallbackMessage) {
    return fallbackMessage;
  }

  if (responseStatus === 404) {
    return "文件不存在或已被删除。";
  }

  if (responseStatus === 401 || responseStatus === 403) {
    return "没有权限下载该文件，请检查会话或权限配置。";
  }

  if (responseStatus === 400) {
    return "下载参数无效，可能是目录或路径错误。";
  }

  if (responseStatus >= 500) {
    return "下载失败：服务暂时不可用，请稍后重试。";
  }

  return `下载失败 (${responseStatus})`;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function sourceLabel(source: WorkspaceUploadItem["source"]): string {
  if (source === "drag") return "拖拽";
  if (source === "folder-picker") return "文件夹";
  return "文件";
}

function statusLabel(status: WorkspaceUploadItem["status"]): string {
  if (status === "pending") return "pending";
  if (status === "uploading") return "uploading";
  if (status === "success") return "success";
  return "error";
}

function statusIcon(item: WorkspaceUploadItem) {
  if (item.status === "uploading") {
    return <IconLoader className="h-3.5 w-3.5 animate-spin text-accent-orange" />;
  }
  if (item.status === "success") {
    return <IconCheck className="h-3.5 w-3.5 text-success" />;
  }
  if (item.status === "error") {
    return <IconX className="h-3.5 w-3.5 text-danger" />;
  }
  return <IconClock className="h-3.5 w-3.5 text-text-tertiary" />;
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitMs(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export default function FileSidebar({ sessionId, open, onClose }: FileSidebarProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [uploadQueue, setUploadQueue] = useState<WorkspaceUploadItem[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<DownloadNotice | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadQueueRef = useRef<WorkspaceUploadItem[]>([]);
  const pendingUploadIdsRef = useRef<string[]>([]);
  const processingUploadsRef = useRef(false);

  const updateUploadQueue = useCallback((updater: UploadQueueUpdater) => {
    setUploadQueue((prev) => {
      const next = updater(prev);
      uploadQueueRef.current = next;
      return next;
    });
  }, []);

  const fetchFiles = useCallback(
    async (
      subPath: string = "",
      options?: { force?: boolean; silent?: boolean },
    ) => {
      if (!sessionId) return;
      const shouldShowLoading = !options?.silent;
      if (shouldShowLoading) {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({ sessionId });
        if (subPath) params.set("path", subPath);
        if (options?.force) {
          params.set("_ts", String(Date.now()));
        }

        const res = await fetch(`/api/workspace/files?${params}`, {
          cache: options?.force ? "no-store" : "default",
        });
        if (res.ok) {
          const data = await res.json();
          setFiles(data.files || []);
        }
      } catch (error) {
        console.error("Failed to fetch files:", error);
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        }
      }
    },
    [sessionId],
  );

  const forceRefreshAfterUpload = useCallback(
    async (subPath: string) => {
      for (
        let attempt = 0;
        attempt < UPLOAD_FORCE_REFRESH_RETRY_COUNT;
        attempt += 1
      ) {
        await fetchFiles(subPath, {
          force: true,
          silent: attempt > 0,
        });
        if (attempt < UPLOAD_FORCE_REFRESH_RETRY_COUNT - 1) {
          await waitMs(UPLOAD_FORCE_REFRESH_INTERVAL_MS);
        }
      }
    },
    [fetchFiles],
  );

  const markBatchStatus = useCallback(
    (ids: string[], status: WorkspaceUploadItem["status"], errorMessage?: string) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      updateUploadQueue((prev) =>
        prev.map((item) => {
          if (!idSet.has(item.id)) {
            return item;
          }

          if (status === "error") {
            return { ...item, status, error: errorMessage || "上传失败" };
          }

          return {
            ...item,
            status,
            error: status === "success" ? undefined : item.error,
          };
        }),
      );
    },
    [updateUploadQueue],
  );

  const processPendingUploads = useCallback(async () => {
    if (processingUploadsRef.current || !sessionId) {
      return;
    }

    processingUploadsRef.current = true;
    setUploading(true);

    let shouldRefreshFiles = false;

    try {
      while (pendingUploadIdsRef.current.length > 0) {
        const pendingIdsSnapshot = [...pendingUploadIdsRef.current];
        pendingUploadIdsRef.current = [];

        const deferredIds: string[] = [];
        const batchIds: string[] = [];
        let batchTotalBytes = 0;

        for (const id of pendingIdsSnapshot) {
          const item = uploadQueueRef.current.find((entry) => entry.id === id);
          if (!item) {
            continue;
          }

          const isBatchFull = batchIds.length >= MAX_UPLOAD_BATCH_FILES;
          const exceedsBatchBytes =
            batchIds.length > 0 &&
            batchTotalBytes + item.size > MAX_UPLOAD_BATCH_TOTAL_BYTES;

          if (isBatchFull || exceedsBatchBytes) {
            deferredIds.push(id);
            continue;
          }

          batchIds.push(id);
          batchTotalBytes += item.size;
        }

        pendingUploadIdsRef.current.push(...deferredIds);
        const batchItems = batchIds
          .map((id) => uploadQueueRef.current.find((item) => item.id === id))
          .filter((item): item is WorkspaceUploadItem => Boolean(item));

        if (batchItems.length === 0) {
          continue;
        }

        const activeIds = batchItems.map((item) => item.id);
        markBatchStatus(activeIds, "uploading");

        const formData = new FormData();
        formData.set("sessionId", sessionId);
        if (currentPath) {
          formData.set("path", currentPath);
        }

        for (const item of batchItems) {
          formData.append("file", item.file);
          formData.append("relativePath", item.relativePath);
        }

        try {
          const abortController = new AbortController();
          const timeoutId = window.setTimeout(() => {
            abortController.abort();
          }, UPLOAD_REQUEST_TIMEOUT_MS);
          let res: Response;
          try {
            res = await fetch("/api/workspace/files", {
              method: "POST",
              body: formData,
              signal: abortController.signal,
            });
          } finally {
            window.clearTimeout(timeoutId);
          }

          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            const message = body.error || `上传失败 (${res.status})`;
            markBatchStatus(activeIds, "error", message);
            setUploadError(message);
            continue;
          }

          shouldRefreshFiles = true;
          markBatchStatus(activeIds, "success");
        } catch (error) {
          const message =
            error instanceof Error && error.name === "AbortError"
              ? "上传超时，请重试或减少单次上传文件数量。"
              : error instanceof Error
                ? error.message
                : "上传失败";
          markBatchStatus(activeIds, "error", message);
          setUploadError(message);
        }

        await yieldToMainThread();
      }
    } finally {
      processingUploadsRef.current = false;
      setUploading(false);
      if (shouldRefreshFiles) {
        await forceRefreshAfterUpload(currentPath);
      }
    }
  }, [currentPath, forceRefreshAfterUpload, markBatchStatus, sessionId]);

  const enqueueUploads = useCallback(
    (items: WorkspaceUploadItem[]) => {
      if (!items.length) {
        return;
      }

      // Keep the ref in sync immediately so the upload worker can read
      // newly enqueued items in the same tick.
      const nextQueue = [...uploadQueueRef.current, ...items];
      uploadQueueRef.current = nextQueue;
      setUploadQueue(nextQueue);
      pendingUploadIdsRef.current.push(...items.map((item) => item.id));
      void processPendingUploads();
    },
    [processPendingUploads],
  );

  const collectFromSelection = useCallback(
    async (fileList: FileList | null, source: WorkspaceUploadItem["source"]) => {
      if (!fileList || fileList.length === 0) {
        if (source === "folder-picker") {
          setUploadError("未检测到文件。请确认所选目录包含可读取文件。");
        }
        return;
      }

      const result = await collectUploadItemsFromFileSelection(fileList, source, {
        limits: {
          maxFiles: MAX_UPLOAD_FILES,
          maxTotalBytes: MAX_UPLOAD_TOTAL_BYTES,
        },
        yieldEvery: 50,
      });

      if (result.errors.length > 0) {
        setUploadError(result.errors.join(" "));
      }

      if (result.items.length === 0 && result.errors.length === 0) {
        setUploadError("未检测到可上传文件。请检查文件夹是否为空。");
      }

      enqueueUploads(result.items);
    },
    [enqueueUploads],
  );

  const handleDropTransfer = useCallback(
    async (dataTransfer: DataTransfer) => {
      const result = await collectUploadItemsFromDrop(dataTransfer, {
        limits: {
          maxFiles: MAX_UPLOAD_FILES,
          maxTotalBytes: MAX_UPLOAD_TOTAL_BYTES,
        },
        yieldEvery: 50,
      });

      if (result.errors.length > 0) {
        setUploadError(result.errors.join(" "));
      }

      if (result.items.length === 0 && result.errors.length === 0) {
        setUploadError("未检测到可上传文件。请检查文件夹是否为空。");
      }

      enqueueUploads(result.items);
    },
    [enqueueUploads],
  );

  useEffect(() => {
    setCurrentPath("");
    setExpandedDirs(new Set());
    setUploadError(null);
    setDownloadNotice(null);
    setContextMenu(null);
    setDownloadingPath(null);
    pendingUploadIdsRef.current = [];
    uploadQueueRef.current = [];
    setUploadQueue([]);
  }, [sessionId]);

  useEffect(() => {
    if (!open || !sessionId) return;

    const intervalId = window.setInterval(() => {
      void fetchFiles(currentPath);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [open, sessionId, currentPath, fetchFiles]);

  useEffect(() => {
    if (open && sessionId) {
      void fetchFiles(currentPath);
    }
  }, [open, sessionId, currentPath, fetchFiles]);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    // Some browsers only enable folder picking when the attribute is set on
    // the real DOM node (not just JSX props), so we keep both.
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const handleDelete = async (filePath: string) => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/workspace/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, path: filePath }),
      });
      if (res.ok) {
        await fetchFiles(currentPath);
      }
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const handleItemContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, file: FileInfo) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        file,
      });
      if (file.isDirectory) {
        setDownloadNotice({
          type: "info",
          message: "目录暂不支持直接下载。",
        });
      } else {
        setDownloadNotice(null);
      }
    },
    [],
  );

  const handleDownloadFile = useCallback(
    async (file: FileInfo) => {
      if (!sessionId) {
        setDownloadNotice({
          type: "error",
          message: "下载失败：缺少会话信息。",
        });
        return;
      }

      if (file.isDirectory) {
        setDownloadNotice({
          type: "info",
          message: "目录暂不支持直接下载。",
        });
        return;
      }

      if (downloadingPath === file.path) {
        return;
      }

      setDownloadingPath(file.path);
      setDownloadNotice(null);

      try {
        const response = await fetch(
          buildWorkspaceFileDownloadUrl(sessionId, file.path),
          { method: "GET" },
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as DownloadErrorResponse;
          setDownloadNotice({
            type: "error",
            message: getWorkspaceFileDownloadErrorMessage(
              response.status,
              payload.error,
            ),
          });
          return;
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get("Content-Disposition");
        const preferredName = extractFilenameFromContentDisposition(contentDisposition);
        const downloadName = preferredName || file.name;
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = blobUrl;
        link.download = downloadName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);

        setDownloadNotice({
          type: "success",
          message: `已开始下载：${downloadName}`,
        });
      } catch (error) {
        const fallbackMessage = error instanceof Error ? error.message : "";
        setDownloadNotice({
          type: "error",
          message: getWorkspaceFileDownloadErrorMessage(500, fallbackMessage),
        });
      } finally {
        setDownloadingPath(null);
      }
    },
    [downloadingPath, sessionId],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setUploadError(null);
    void handleDropTransfer(e.dataTransfer);
  };

  const navigateToDir = (dirPath: string) => {
    setCurrentPath(dirPath);
  };

  const navigateUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
    navigateToDir(dirPath);
  };

  const handleRetryFailed = useCallback(() => {
    const failedIds = uploadQueueRef.current
      .filter((item) => item.status === "error")
      .map((item) => item.id);

    if (failedIds.length === 0) {
      return;
    }

    const idSet = new Set(failedIds);
    updateUploadQueue((prev) =>
      prev.map((item) =>
        idSet.has(item.id)
          ? { ...item, status: "pending", error: undefined }
          : item,
      ),
    );

    pendingUploadIdsRef.current.push(...failedIds);
    setUploadError(null);
    void processPendingUploads();
  }, [processPendingUploads, updateUploadQueue]);

  const handleClearQueue = useCallback(() => {
    if (uploading) {
      return;
    }

    pendingUploadIdsRef.current = [];
    updateUploadQueue(() => []);
    setUploadError(null);
  }, [updateUploadQueue, uploading]);

  const breadcrumbs = ["workspace", ...currentPath.split("/").filter(Boolean)];

  const uploadSummary = useMemo(() => {
    return {
      pending: uploadQueue.filter((item) => item.status === "pending").length,
      uploading: uploadQueue.filter((item) => item.status === "uploading").length,
      success: uploadQueue.filter((item) => item.status === "success").length,
      error: uploadQueue.filter((item) => item.status === "error").length,
    };
  }, [uploadQueue]);

  const hasFailedItems = uploadSummary.error > 0;

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-[var(--color-overlay)] md:hidden ${open ? "block" : "hidden"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed left-0 top-0 z-40 flex h-full w-[320px] flex-col border-r border-border bg-[var(--color-glass-surface)] backdrop-blur-xl transition-transform duration-300 md:static md:z-auto ${
          open ? "translate-x-0" : "-translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden md:border-r-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <IconFolder className="h-5 w-5 text-accent-orange" />
            <span className="text-sm font-semibold">Files</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-accent-orange"
              title="Upload files"
              disabled={uploading}
            >
              <IconPlus className="h-4 w-4" />
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-accent-orange"
              title="Upload folder"
              disabled={uploading}
            >
              <IconFolder className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-secondary md:hidden"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border px-4 py-2 text-xs text-text-tertiary">
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <button
                className="hover:text-accent-orange"
                onClick={() => {
                  if (i === 0) setCurrentPath("");
                  else {
                    const newPath = breadcrumbs.slice(1, i + 1).join("/");
                    setCurrentPath(newPath);
                  }
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        <div
          className={`flex-1 overflow-y-auto ${dragOver ? "bg-accent-orange-light ring-2 ring-inset ring-accent-orange" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            const nextTarget = e.relatedTarget;
            if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
              return;
            }
            setDragOver(false);
          }}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <IconLoader className="h-6 w-6 animate-spin text-text-tertiary" />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-text-tertiary">
              <IconFolder className="mb-3 h-10 w-10 opacity-30" />
              <p>No files yet</p>
              <p className="mt-1 text-xs">Upload files/folders or drag & drop here</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {currentPath && (
                <li>
                  <button
                    onClick={navigateUp}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-text-tertiary hover:bg-bg-secondary"
                  >
                    <span>..</span>
                  </button>
                </li>
              )}
              {files.map((file) => (
                <li key={file.path} className="group">
                  <div
                    className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg-secondary"
                    onContextMenu={(event) => handleItemContextMenu(event, file)}
                    data-file-path={file.path}
                  >
                    {file.isDirectory ? (
                      <button
                        onClick={() => toggleDir(file.path)}
                        className="flex flex-1 items-center gap-2"
                        data-testid={`workspace-dir-${file.path}`}
                      >
                        {expandedDirs.has(file.path) ? (
                          <IconChevronDown className="h-3 w-3 text-text-tertiary" />
                        ) : (
                          <IconChevronRight className="h-3 w-3 text-text-tertiary" />
                        )}
                        <IconFolder className="h-4 w-4 text-accent-orange" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ) : (
                      <div className="flex flex-1 items-center gap-2" data-testid={`workspace-file-${file.path}`}>
                        <span className="w-3" />
                        <IconFile className="h-4 w-4 text-text-tertiary" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-text-tertiary">
                          {formatFileSize(file.size)}
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => handleDelete(file.path)}
                      className="rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      title="Delete"
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`mb-3 cursor-pointer rounded-lg border-2 border-dashed px-3 py-3 text-center text-sm transition-colors ${
              dragOver
                ? "border-accent-orange bg-accent-orange-light text-accent-orange"
                : "border-border bg-bg-secondary/30 text-text-tertiary hover:border-accent-orange hover:text-accent-orange"
            }`}
          >
            <p className="font-medium">拖拽文件或文件夹到这里</p>
            <p className="mt-1 text-xs">或点击选择文件（支持目录递归上传）</p>
          </div>

          <div className="mt-1 flex items-center justify-between text-[11px] text-text-tertiary">
            <span>
              pending {uploadSummary.pending} · uploading {uploadSummary.uploading} · success {uploadSummary.success} · error {uploadSummary.error}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRetryFailed}
                disabled={!hasFailedItems || uploading}
                className="rounded px-1.5 py-0.5 transition-colors hover:text-accent-orange disabled:cursor-not-allowed disabled:opacity-40"
              >
                重试失败项
              </button>
              <button
                onClick={handleClearQueue}
                disabled={uploading || uploadQueue.length === 0}
                className="rounded px-1.5 py-0.5 transition-colors hover:text-accent-orange disabled:cursor-not-allowed disabled:opacity-40"
              >
                清空队列
              </button>
            </div>
          </div>

          {downloadNotice && (
            <div
              className={`mt-2 rounded-md px-2 py-1 text-xs ${
                downloadNotice.type === "error"
                  ? "border border-danger/40 bg-danger/10 text-danger"
                  : downloadNotice.type === "success"
                    ? "border border-success/40 bg-success/10 text-success"
                    : "border border-border bg-bg-secondary/40 text-text-secondary"
              }`}
            >
              {downloadNotice.message}
            </div>
          )}

          {uploadError && (
            <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
              {uploadError}
            </div>
          )}

          {uploadQueue.length > 0 && (
            <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-border bg-bg-secondary/20">
              <ul className="divide-y divide-border">
                {uploadQueue.map((item) => (
                  <li key={item.id} className="px-2 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      {statusIcon(item)}
                      <span className="truncate text-text-primary" title={item.relativePath}>
                        {item.relativePath}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-tertiary">
                      <span>{sourceLabel(item.source)}</span>
                      <span>
                        {statusLabel(item.status)} · {formatFileSize(item.size)}
                      </span>
                    </div>
                    {item.status === "error" && item.error && (
                      <p className="mt-0.5 text-[11px] text-danger">{item.error}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {uploading && (
            <div className="mt-2 flex items-center gap-1 text-xs text-accent-orange">
              <IconLoader className="h-3.5 w-3.5 animate-spin" />
              正在上传...
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            setUploadError(null);
            void collectFromSelection(e.target.files, "file-picker");
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
          }}
        />

        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          {...folderPickerAttributes}
          onChange={(e) => {
            setUploadError(null);
            void collectFromSelection(e.target.files, "folder-picker");
            if (folderInputRef.current) {
              folderInputRef.current.value = "";
            }
          }}
        />
      </aside>

      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="absolute min-w-44 rounded-md border border-border bg-bg-surface p-1 shadow-lg"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            aria-label="文件操作菜单"
            data-testid="file-sidebar-context-menu"
          >
            <button
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-text-primary transition-colors hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void handleDownloadFile(contextMenu.file);
                setContextMenu(null);
              }}
              disabled={contextMenu.file.isDirectory || downloadingPath === contextMenu.file.path}
            >
              {downloadingPath === contextMenu.file.path ? "下载中..." : "下载文件"}
            </button>
            {contextMenu.file.isDirectory && (
              <p className="px-2 py-1 text-xs text-text-tertiary">
                目录暂不支持直接下载。
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
