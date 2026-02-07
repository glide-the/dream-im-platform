"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { IconArrowUp, IconFile, IconLoader, IconStop, IconX } from "./Icons";
import {
  QUICK_INPUT_ACTIONS_CLASS_NAME,
  QUICK_INPUT_ADD_BUTTON_CLASS_NAME,
  QUICK_INPUT_FIELD_CLASS_NAME,
  QUICK_INPUT_SEND_BUTTON_CLASS_NAME,
  QUICK_INPUT_SHELL_CLASS_NAME,
} from "./chatInputStyles";
import { useFileUpload } from "../hooks/useFileUpload";
import { shouldSendMessageOnKeyDown } from "./chat/interaction-utils";

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
  url?: string;
  dataUrl?: string;
  progress?: number;
  isUploading?: boolean;
  abortController?: AbortController;
  file?: File;
  workspacePath?: string;
  savedAt?: string;
  hash?: string;
  uploadSource?: "click" | "paste" | "drag";
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  url?: string;
  workspacePath?: string;
  savedAt?: string;
  hash?: string;
  uploadSource?: "click" | "paste" | "drag";
}

export function toAttachment(file: UploadedFile): Attachment {
  return {
    name: file.name,
    type: file.mimeType,
    size: file.size,
    url: file.url,
    workspacePath: file.workspacePath,
    savedAt: file.savedAt,
    hash: file.hash,
    uploadSource: file.uploadSource,
  };
}

export interface ContextCustomer {
  id: string;
  name?: string;
  company?: string;
}

export type ToolChoice = "auto" | "none" | "manual";
export type AIInputDockMode = "simple" | "full";

interface AIInputDockProps {
  contextCustomerId?: string;
  contextCustomers?: ContextCustomer[];
  onSendMessage: (
    message: string,
    files?: UploadedFile[],
    customerIds?: string[],
    toolChoice?: ToolChoice,
  ) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  defaultToolChoice?: ToolChoice;
  openFileDialogSignal?: number;
  onStop?: () => void;
  mode?: AIInputDockMode;
  workspaceSessionId?: string;
}

let fileDialogOpenLocked = false;

export function shouldHandleOpenFileDialogSignal(
  signal: number | undefined,
  lastHandledSignal: number,
): signal is number {
  return typeof signal === "number" && signal > 0 && signal !== lastHandledSignal;
}

export function runWithFileDialogTaskLock(callback: () => void): boolean {
  if (fileDialogOpenLocked) return false;
  fileDialogOpenLocked = true;
  callback();
  queueMicrotask(() => {
    fileDialogOpenLocked = false;
  });
  return true;
}

function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shouldSendWithKeyboard(mode: AIInputDockMode, event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.nativeEvent.isComposing) return false;
  if (mode === "full") {
    return shouldSendMessageOnKeyDown({
      key: event.key,
      metaKey: event.metaKey || event.ctrlKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    });
  }
  return event.key === "Enter";
}

export default function AIInputDock({
  contextCustomerId,
  contextCustomers = [],
  onSendMessage,
  placeholder = "Press i to chat",
  disabled = false,
  loading = false,
  defaultToolChoice = "auto",
  openFileDialogSignal,
  onStop,
  mode = "simple",
  workspaceSessionId,
}: AIInputDockProps) {
  const [query, setQuery] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastHandledOpenFileDialogSignalRef = useRef(0);
  const { upload, error: uploadHookError } = useFileUpload();

  const openAttachmentDialog = useCallback(() => {
    runWithFileDialogTaskLock(() => {
      fileInputRef.current?.click();
    });
  }, []);

  useEffect(() => {
    if (
      !shouldHandleOpenFileDialogSignal(
        openFileDialogSignal,
        lastHandledOpenFileDialogSignalRef.current,
      )
    ) {
      return;
    }
    lastHandledOpenFileDialogSignalRef.current = openFileDialogSignal;
    openAttachmentDialog();
  }, [openAttachmentDialog, openFileDialogSignal]);

  const syncFileToWorkspace = useCallback(
    async (file: File) => {
      if (!workspaceSessionId) return undefined;

      const formData = new FormData();
      formData.set("sessionId", workspaceSessionId);
      formData.set("path", "files");
      formData.append("file", file);

      const response = await fetch("/api/workspace/files", {
        method: "POST",
        body: formData,
      });
      const responseBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        uploaded?: string[];
        files?: Array<{
          workspacePath: string;
          savedAt: string;
          hash?: string;
        }>;
      };

      if (!response.ok) {
        const message = responseBody.error || "工作空间文件同步失败";
        throw new Error(responseBody.code ? `${message} (${responseBody.code})` : message);
      }

      const metadata = responseBody.files?.[0];
      if (metadata?.workspacePath) {
        return metadata;
      }

      const fallbackPath = responseBody.uploaded?.[0];
      if (!fallbackPath) {
        throw new Error("工作空间文件同步成功但未返回文件路径");
      }

      return {
        workspacePath: fallbackPath,
        savedAt: new Date().toISOString(),
      };
    },
    [workspaceSessionId],
  );

  const uploadFileToStorage = useCallback(
    async (fileId: string, file: File) => {
      try {
        const workspaceMetadata = await syncFileToWorkspace(file);
        const result = await upload(file, {
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          onProgress: (progress) => {
            setUploadedFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, progress } : f)));
          },
        });

        if (!result) {
          setUploadedFiles((prev) => {
            const fileInList = prev.find((f) => f.id === fileId);
            if (fileInList?.previewUrl) {
              URL.revokeObjectURL(fileInList.previewUrl);
            }
            return prev.filter((f) => f.id !== fileId);
          });
          return;
        }

        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  url: result.url,
                  progress: 100,
                  isUploading: false,
                  workspacePath: workspaceMetadata?.workspacePath,
                  savedAt: workspaceMetadata?.savedAt,
                  hash: workspaceMetadata?.hash,
                }
              : f,
          ),
        );
      } catch (err) {
        console.error("Upload failed:", err);
        setUploadedFiles((prev) => {
          const fileInList = prev.find((f) => f.id === fileId);
          if (fileInList?.previewUrl) {
            URL.revokeObjectURL(fileInList.previewUrl);
          }
          return prev.filter((f) => f.id !== fileId);
        });
        setUploadError(err instanceof Error ? err.message : "上传失败");
        setTimeout(() => setUploadError(null), 5000);
      }
    },
    [syncFileToWorkspace, upload],
  );

  const handleFiles = useCallback(
    (files: FileList | null, uploadSource: "click" | "paste" | "drag") => {
      if (!files || files.length === 0) return;

      const MAX_FILE_SIZE = 50 * 1024 * 1024;
      const newFiles: UploadedFile[] = [];
      const filesToUpload: Array<{ id: string; file: File }> = [];

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (file.size > MAX_FILE_SIZE) {
          setUploadError(`${file.name}: 文件过大 (最大 50MB)`);
          setTimeout(() => setUploadError(null), 5000);
          continue;
        }

        const fileId = generateFileId();
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        newFiles.push({
          id: fileId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          previewUrl,
          progress: 0,
          isUploading: true,
          abortController: new AbortController(),
          file,
          uploadSource,
        });
        filesToUpload.push({ id: fileId, file });
      }

      if (newFiles.length === 0) return;
      setUploadedFiles((prev) => [...prev, ...newFiles]);
      for (const { id, file } of filesToUpload) {
        void uploadFileToStorage(id, file);
      }
    },
    [uploadFileToStorage],
  );

  const deleteFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => {
      const fileInList = prev.find((f) => f.id === fileId);
      if (fileInList?.isUploading && fileInList.abortController) {
        fileInList.abortController.abort();
      }
      if (fileInList?.previewUrl) {
        URL.revokeObjectURL(fileInList.previewUrl);
      }
      return prev.filter((f) => f.id !== fileId);
    });
  }, []);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleFiles(event.target.files, "click");
      event.target.value = "";
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      handleFiles(event.dataTransfer.files, "drag");
    },
    [handleFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const clipboardFiles = event.clipboardData?.files;
      if (!clipboardFiles || clipboardFiles.length === 0) {
        return;
      }
      event.preventDefault();
      handleFiles(clipboardFiles, "paste");
    },
    [handleFiles],
  );

  const handleSend = useCallback(() => {
    if (loading) return;
    if (uploadedFiles.some((file) => file.isUploading)) {
      setUploadError("请等待文件上传完成");
      setTimeout(() => setUploadError(null), 3000);
      return;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery && uploadedFiles.length === 0) return;

    const customerIds = contextCustomers.map((customer) => customer.id);
    if (contextCustomerId && !customerIds.includes(contextCustomerId)) {
      customerIds.push(contextCustomerId);
    }

    onSendMessage(
      trimmedQuery,
      uploadedFiles.length > 0 ? uploadedFiles : undefined,
      customerIds,
      defaultToolChoice,
    );
    setQuery("");
    uploadedFiles.forEach((file) => {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setUploadedFiles([]);
  }, [
    contextCustomerId,
    contextCustomers,
    defaultToolChoice,
    loading,
    onSendMessage,
    query,
    uploadedFiles,
  ]);

  const hasUploadingFiles = uploadedFiles.some((file) => file.isUploading);

  return (
    <div
      data-mode={mode}
      className={`${QUICK_INPUT_SHELL_CLASS_NAME} ${isDragOver ? "border-accent-orange bg-accent-orange-light" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov,image/*"
        onChange={handleFileInputChange}
        disabled={disabled}
      />

      {(uploadError || uploadHookError) && (
        <div className="mb-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">
          {uploadError || uploadHookError}
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {uploadedFiles.map((file) => {
            const isImage = file.mimeType.startsWith("image/");
            const displayExt = file.name.split(".").pop()?.toUpperCase() || "FILE";
            return (
              <div
                key={file.id}
                className="group relative overflow-hidden rounded-lg border-2 border-border transition-all hover:border-accent-orange"
              >
                {isImage && file.previewUrl ? (
                  <img src={file.previewUrl} alt={file.name} className="h-20 w-20 object-cover" />
                ) : (
                  <div className="flex h-20 w-28 flex-col items-center justify-center bg-bg-surface px-2 py-2 text-center">
                    <IconFile className="mb-1 h-6 w-6 text-text-tertiary" />
                    <span className="w-full truncate text-[10px] font-medium text-text-secondary">
                      {file.name}
                    </span>
                    <span className="text-[9px] text-text-tertiary">
                      {displayExt} · {formatFileSize(file.size)}
                    </span>
                  </div>
                )}
                {file.isUploading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/90 backdrop-blur-sm">
                    <IconLoader className="mb-1 h-5 w-5 animate-spin text-accent-orange" />
                    <div className="h-1 w-12 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full bg-accent-orange transition-all duration-300"
                        style={{ width: `${file.progress || 0}%` }}
                      />
                    </div>
                    <span className="mt-1 text-[10px] text-text-secondary">
                      {Math.round(file.progress || 0)}%
                    </span>
                  </div>
                )}
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm transition-opacity ${
                    file.isUploading ? "opacity-0" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <button
                    type="button"
                    className="rounded-full bg-bg-surface p-1.5 text-text-secondary transition-colors hover:bg-danger-light hover:text-danger"
                    onClick={() => deleteFile(file.id)}
                    disabled={file.isUploading}
                    aria-label={`删除文件 ${file.name}`}
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-text-tertiary">
        <span>上传方式：粘贴 (Ctrl/Cmd + V) · 拖拽 · 点击选择</span>
        {mode === "full" && <span>⌘/Ctrl + Enter 发送</span>}
      </div>

      <input
        id="chat-input"
        aria-label="聊天输入"
        className={QUICK_INPUT_FIELD_CLASS_NAME}
        maxLength={2000}
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        onKeyDown={(event) => {
          if (!shouldSendWithKeyboard(mode, event)) return;
          event.preventDefault();
          handleSend();
        }}
      />

      <div className={QUICK_INPUT_ACTIONS_CLASS_NAME}>
        <button
          type="button"
          aria-label="添加附件"
          onClick={openAttachmentDialog}
          className={QUICK_INPUT_ADD_BUTTON_CLASS_NAME}
          disabled={disabled}
        >
          + Add
        </button>

        {loading && onStop ? (
          <button
            className="grid h-9 w-9 place-items-center rounded-full bg-danger text-white shadow-medium transition-all duration-200 hover:scale-105 hover:bg-danger/90 active:scale-95"
            onClick={onStop}
            title="停止生成"
            aria-label="停止生成"
            type="button"
          >
            <IconStop className="h-4 w-4" />
          </button>
        ) : (
          <button
            className={`${QUICK_INPUT_SEND_BUTTON_CLASS_NAME} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-accent-orange`}
            onClick={handleSend}
            disabled={loading || disabled || hasUploadingFiles || (!query.trim() && uploadedFiles.length === 0)}
            title={hasUploadingFiles ? "等待上传完成..." : "发送"}
            aria-label="发送消息"
            type="button"
          >
            {hasUploadingFiles ? <IconLoader className="h-4 w-4 animate-spin" /> : <IconArrowUp className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
