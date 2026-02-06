"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { IconPaperclip, IconImage, IconCamera, IconSend, IconX, IconFile, IconLoader, IconStop } from "./Icons";
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
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  url?: string;
}

export function toAttachment(file: UploadedFile): Attachment {
  return {
    name: file.name,
    type: file.mimeType,
    size: file.size,
    url: file.url,
  };
}

export interface ContextCustomer {
  id: string;
  name?: string;
  company?: string;
}

export type ToolChoice = "auto" | "none" | "manual";

interface AIInputDockProps {
  contextCustomerId?: string;
  contextCustomers?: ContextCustomer[];
  onSendMessage: (message: string, files?: UploadedFile[], customerIds?: string[], toolChoice?: ToolChoice) => void;
  onAddContextCustomer?: () => void;
  onRemoveContextCustomer?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  defaultToolChoice?: ToolChoice;
  openFileDialogSignal?: number;
  onStop?: () => void;
}

const MAX_MESSAGE_LENGTH = 2000;

function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AIInputDock({
  contextCustomerId,
  contextCustomers = [],
  onSendMessage,
  onAddContextCustomer,
  onRemoveContextCustomer,
  placeholder = "Press i chat",
  disabled = false,
  loading = false,
  defaultToolChoice = "auto",
  openFileDialogSignal,
  onStop,
}: AIInputDockProps) {
  const [query, setQuery] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [toolChoice, setToolChoice] = useState<ToolChoice>(defaultToolChoice);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isTextareaFocused, setIsTextareaFocused] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const { upload, error: uploadHookError } = useFileUpload();

  useEffect(() => {
    if (!openFileDialogSignal) return;
    fileInputRef.current?.click();
  }, [openFileDialogSignal]);

  useEffect(() => {
    const closeMenuOnOutsideClick = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };

    window.addEventListener("click", closeMenuOnOutsideClick);
    return () => window.removeEventListener("click", closeMenuOnOutsideClick);
  }, []);

  const uploadFileToStorage = useCallback(async (fileId: string, file: File) => {
    try {
      const result = await upload(file, {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        onProgress: (progress) => {
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, progress } : f
            )
          );
        },
      });

      if (result) {
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, url: result.url, progress: 100, isUploading: false }
              : f
          )
        );
      } else {
        setUploadedFiles((prev) => {
          const fileInList = prev.find((f) => f.id === fileId);
          if (fileInList?.previewUrl) {
            URL.revokeObjectURL(fileInList.previewUrl);
          }
          return prev.filter((f) => f.id !== fileId);
        });
      }
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
  }, [upload]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const newFiles: UploadedFile[] = [];
    const filesToUpload: { id: string; file: File }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`${file.name}: 文件过大 (最大 50MB)`);
        setTimeout(() => setUploadError(null), 5000);
        continue;
      }

      const fileId = generateFileId();
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;

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
      });
      filesToUpload.push({ id: fileId, file });
    }

    if (newFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...newFiles]);
      for (const { id, file } of filesToUpload) {
        uploadFileToStorage(id, file);
      }
    }
  }, [uploadFileToStorage]);

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

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = "";
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  function handleSend() {
    if (loading) return;
    if (uploadedFiles.some((file) => file.isUploading)) {
      setUploadError("请等待文件上传完成");
      setTimeout(() => setUploadError(null), 3000);
      return;
    }
    if (!query.trim() && uploadedFiles.length === 0) return;

    const customerIds = contextCustomers.map((c) => c.id);
    if (contextCustomerId && !customerIds.includes(contextCustomerId)) {
      customerIds.push(contextCustomerId);
    }

    onSendMessage(query, uploadedFiles.length > 0 ? uploadedFiles : undefined, customerIds, toolChoice);
    setQuery("");
    uploadedFiles.forEach((file) => {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setUploadedFiles([]);
  }

  const hasUploadingFiles = uploadedFiles.some((f) => f.isUploading);

  return (
    <div
      className={`rounded-2xl border bg-bg-primary p-3 transition-colors ${isDragOver ? "border-accent-orange bg-accent-orange-light" : "border-border"
        }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov,image/*" onChange={handleFileInputChange} disabled={disabled} />
      <input ref={imageInputRef} type="file" className="hidden" multiple accept="image/*" onChange={handleFileInputChange} disabled={disabled} />
      <input ref={cameraInputRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleFileInputChange} disabled={disabled} />

      {(uploadError || uploadHookError) && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{uploadError || uploadHookError}</div>
      )}

      <div className="mb-2 flex items-center">
        <span className="ml-auto text-xs text-text-tertiary">⌘ + Enter 发送</span>
      </div>

      {uploadedFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {uploadedFiles.map((file) => {
            const isImage = file.mimeType.startsWith("image/");
            const displayExt = file.name.split(".").pop()?.toUpperCase() || "FILE";
            return (
              <div key={file.id} className="group relative overflow-hidden rounded-lg border-2 border-border transition-all hover:border-accent-orange">
                {isImage && file.previewUrl ? (
                  <img src={file.previewUrl} alt={file.name} className="h-20 w-20 object-cover" />
                ) : (
                  <div className="flex h-20 w-28 flex-col items-center justify-center bg-bg-surface px-2 py-2 text-center">
                    <IconFile className="mb-1 h-6 w-6 text-text-tertiary" />
                    <span className="w-full truncate text-[10px] font-medium text-text-secondary">{file.name}</span>
                    <span className="text-[9px] text-text-tertiary">{displayExt} · {formatFileSize(file.size)}</span>
                  </div>
                )}
                {file.isUploading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/90 backdrop-blur-sm">
                    <IconLoader className="mb-1 h-5 w-5 animate-spin text-accent-orange" />
                    <div className="h-1 w-12 overflow-hidden rounded-full bg-border">
                      <div className="h-full bg-accent-orange transition-all duration-300" style={{ width: `${file.progress || 0}%` }} />
                    </div>
                    <span className="mt-1 text-[10px] text-text-secondary">{Math.round(file.progress || 0)}%</span>
                  </div>
                )}
                <div className={`absolute inset-0 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm transition-opacity ${file.isUploading ? "opacity-0" : "opacity-0 group-hover:opacity-100"}`}>
                  <button type="button" className="rounded-full bg-bg-surface p-1.5 text-text-secondary transition-colors hover:bg-red-100 hover:text-red-500" onClick={() => deleteFile(file.id)} disabled={file.isUploading} aria-label={`删除文件 ${file.name}`}>
                    <IconX className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <label
            htmlFor="chat-input"
            className={`pointer-events-none absolute left-3 z-10 bg-bg-surface px-1 text-xs text-[#999] transition-all ${isTextareaFocused || query ? "-top-2" : "top-3"}`}
          >
            Press i chat
          </label>
          <textarea
            id="chat-input"
            aria-label="聊天输入"
            className="min-h-[44px] w-full resize-none rounded-md border border-border bg-bg-surface px-4 py-3 pr-16 text-sm text-text-primary shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] placeholder:text-[#999] focus-visible:border-accent-orange focus-visible:ring-2 focus-visible:ring-accent-orange"
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={placeholder}
            value={query}
            onFocus={() => setIsTextareaFocused(true)}
            onBlur={() => setIsTextareaFocused(false)}
            onChange={(event) => setQuery(event.target.value)}
            disabled={disabled}
            onKeyDown={(e) => {
              if (shouldSendMessageOnKeyDown({ key: e.key, metaKey: e.metaKey, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <span className="absolute bottom-1.5 right-2 text-[11px] text-text-tertiary">{query.length}/{MAX_MESSAGE_LENGTH}</span>
        </div>

        <div className="relative" ref={addMenuRef}>
          <button
            type="button"
            aria-label="添加附件"
            onClick={(event) => {
              event.stopPropagation();
              setIsAddMenuOpen((prev) => !prev);
            }}
            className="h-10 rounded-md border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-accent-orange"
          >
            + Add
          </button>
          {isAddMenuOpen && (
            <div className="absolute bottom-12 right-0 z-20 w-32 rounded-md border border-border bg-white p-1 shadow-medium">
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#F5F5F5]" onClick={() => { fileInputRef.current?.click(); setIsAddMenuOpen(false); }} aria-label="上传附件">
                <IconPaperclip className="h-4 w-4" /> 附件
              </button>
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#F5F5F5]" onClick={() => { imageInputRef.current?.click(); setIsAddMenuOpen(false); }} aria-label="上传图片">
                <IconImage className="h-4 w-4" /> 图片
              </button>
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#F5F5F5]" onClick={() => { cameraInputRef.current?.click(); setIsAddMenuOpen(false); }} aria-label="拍照上传">
                <IconCamera className="h-4 w-4" /> 拍照
              </button>
            </div>
          )}
        </div>

        {loading && onStop ? (
          <button
            className="grid h-10 w-10 place-items-center rounded-full bg-red-500 text-white shadow-md transition-transform duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-red-400"
            onClick={onStop}
            title="停止生成"
            aria-label="停止生成"
            type="button"
          >
            <IconStop className="h-5 w-5" />
          </button>
        ) : (
          <button
            className="grid h-10 w-10 place-items-center rounded-full bg-accent-orange text-white shadow-md transition-transform duration-100 active:scale-95 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent-orange"
            onClick={handleSend}
            disabled={loading || disabled || hasUploadingFiles || (!query.trim() && uploadedFiles.length === 0)}
            title={hasUploadingFiles ? "等待上传完成..." : "发送"}
            aria-label="发送消息"
            type="button"
          >
            {hasUploadingFiles ? (
              <IconLoader className="h-5 w-5 animate-spin" />
            ) : (
              <IconSend className="h-5 w-5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
