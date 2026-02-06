"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { IconPaperclip, IconImage, IconCamera, IconSend, IconX, IconFile, IconLoader } from "./Icons";
import { useFileUpload } from "../hooks/useFileUpload";

/** Extended file type with upload status and preview */
export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Preview URL for images (blob URL) */
  previewUrl?: string;
  /** Remote URL after upload completes */
  url?: string;
  /** Data URL for small files */
  dataUrl?: string;
  /** Upload progress 0-100 */
  progress?: number;
  /** Whether file is currently uploading */
  isUploading?: boolean;
  /** Abort controller for canceling uploads */
  abortController?: AbortController;
  /** Original File object for upload */
  file?: File;
}

/** Backward-compatible attachment type alias */
export interface Attachment {
  name: string;
  type: string;
  size: number;
  /** Remote URL after upload completes */
  url?: string;
}

/** Convert UploadedFile to Attachment for backward compatibility */
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

/** Tool choice mode - determines how tool calls are handled */
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
  /** Default tool choice mode */
  defaultToolChoice?: ToolChoice;
  /** increment this value to programmatically open file picker */
  openFileDialogSignal?: number;
}

/** Generate unique file ID */
function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Format file size for display */
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
  placeholder = "输入公司 + 姓名…",
  disabled = false,
  loading = false,
  defaultToolChoice = "auto",
  openFileDialogSignal
}: AIInputDockProps) {
  const [query, setQuery] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [toolChoice, setToolChoice] = useState<ToolChoice>(defaultToolChoice);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
  // File upload hook
  const { upload, error: uploadHookError } = useFileUpload();
  

  useEffect(() => {
    if (openFileDialogSignal === undefined) return;
    fileInputRef.current?.click();
  }, [openFileDialogSignal]);

  /** Upload a single file to storage backend */
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
        // Upload successful - update file with URL
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, url: result.url, progress: 100, isUploading: false }
              : f
          )
        );
      } else {
        // Upload failed - remove file from list
        setUploadedFiles((prev) => {
          const file = prev.find((f) => f.id === fileId);
          if (file?.previewUrl) {
            URL.revokeObjectURL(file.previewUrl);
          }
          return prev.filter((f) => f.id !== fileId);
        });
      }
    } catch (err) {
      console.error("Upload failed:", err);
      // Remove failed file
      setUploadedFiles((prev) => {
        const file = prev.find((f) => f.id === fileId);
        if (file?.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
        return prev.filter((f) => f.id !== fileId);
      });
      
      setUploadError(err instanceof Error ? err.message : "上传失败");
      setTimeout(() => setUploadError(null), 5000);
    }
  }, [upload]);

  /** Process files and add to upload list */
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
    const newFiles: UploadedFile[] = [];
    const filesToUpload: { id: string; file: File }[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`${file.name}: 文件过大 (最大 50MB)`);
        setTimeout(() => setUploadError(null), 5000);
        continue;
      }
      
      const fileId = generateFileId();
      
      // Create preview URL for images
      const previewUrl = file.type.startsWith("image/") 
        ? URL.createObjectURL(file) 
        : undefined;
      
      const uploadedFile: UploadedFile = {
        id: fileId,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        previewUrl,
        progress: 0,
        isUploading: true,
        abortController: new AbortController(),
        file, // Store original file for upload
      };
      
      newFiles.push(uploadedFile);
      filesToUpload.push({ id: fileId, file });
    }
    
    if (newFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...newFiles]);
      
      // Start actual uploads
      for (const { id, file } of filesToUpload) {
        uploadFileToStorage(id, file);
      }
    }
  }, [uploadFileToStorage]);

  /** Delete file from list */
  const deleteFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      
      // Abort upload if still in progress
      if (file?.isUploading && file.abortController) {
        file.abortController.abort();
      }
      
      // Revoke preview URL to free memory
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
      
      return prev.filter((f) => f.id !== fileId);
    });
  }, []);

  /** Handle file input change */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset input so same file can be selected again
      e.target.value = "";
    },
    [handleFiles]
  );

  /** Handle drag events */
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  /** Handle send */
  function handleSend() {
    if (loading) return;
    
    // Check if any files are still uploading
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
    
    // Clear uploaded files and revoke URLs
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
      className={`rounded-2xl border bg-bg-primary p-4 transition-colors ${
        isDragOver ? "border-accent bg-accent/5" : "border-border"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov,image/*"
        onChange={handleFileInputChange}
        disabled={disabled}
      />
      <input
        ref={imageInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*"
        onChange={handleFileInputChange}
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileInputChange}
        disabled={disabled}
      />

      {/* Drag overlay */}
      {isDragOver && (
        <div className="mb-3 rounded-xl border-2 border-dashed border-accent bg-accent/10 p-4 text-center text-sm text-accent">
          释放以上传文件
        </div>
      )}

      {/* Upload error message */}
      {(uploadError || uploadHookError) && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {uploadError || uploadHookError}
        </div>
      )}

      {/* 上下文选择区 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 文件/相册/拍照按钮 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-border bg-bg-surface text-text-secondary hover:bg-bg-surface/80 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="上传文件"
          >
            <IconPaperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-border bg-bg-surface text-text-secondary hover:bg-bg-surface/80 transition-colors"
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled}
            title="上传图片"
          >
            <IconImage className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-border bg-bg-surface text-text-secondary hover:bg-bg-surface/80 transition-colors"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
            title="拍照"
          >
            <IconCamera className="h-4 w-4" />
          </button>
        </div>

        {/* 工具选项 */}
        <select
          className="rounded-full border border-border bg-bg-surface px-2 py-1 text-xs text-text-secondary"
          value={toolChoice}
          onChange={(e) => setToolChoice(e.target.value as ToolChoice)}
          disabled={disabled}
        >
          <option value="auto">🔧 自动</option>
          <option value="manual">✋ 手动确认</option>
          <option value="none">🚫 禁用工具</option>
        </select>

        {/* @客户按钮 */}
        {onAddContextCustomer && (
          <button
            className="rounded-full bg-accent-light px-3 py-1 text-xs font-semibold text-accent"
            onClick={onAddContextCustomer}
            disabled={disabled}
          >
            @客户
          </button>
        )}

        {/* 已选择的上下文客户 */}
        {contextCustomers.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px] text-text-tertiary">
            {contextCustomers.map((customer) => (
              <button
                key={customer.id}
                className="rounded-full border border-border bg-bg-surface px-2 py-1"
                onClick={() => onRemoveContextCustomer?.(customer.id)}
                disabled={disabled}
              >
                @{customer.name ?? "客户"} · 取消
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 上传文件预览区 */}
      {uploadedFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {uploadedFiles.map((file) => {
            const isImage = file.mimeType.startsWith("image/");
            const displayExt = file.name.split(".").pop()?.toUpperCase() || "FILE";
            
            return (
              <div
                key={file.id}
                className="group relative overflow-hidden rounded-lg border-2 border-border transition-all hover:border-accent"
              >
                {/* 图片预览或文件图标 */}
                {isImage && file.previewUrl ? (
                  <img
                    src={file.previewUrl}
                    alt={file.name}
                    className="h-20 w-20 object-cover"
                  />
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

                {/* 上传进度遮罩 */}
                {file.isUploading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/90 backdrop-blur-sm">
                    <IconLoader className="mb-1 h-5 w-5 animate-spin text-accent" />
                    <div className="h-1 w-12 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${file.progress || 0}%` }}
                      />
                    </div>
                    <span className="mt-1 text-[10px] text-text-secondary">
                      {Math.round(file.progress || 0)}%
                    </span>
                  </div>
                )}

                {/* 悬停操作 - 删除按钮 */}
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm transition-opacity ${
                    file.isUploading ? "opacity-0" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <button
                    type="button"
                    className="rounded-full bg-bg-surface p-1.5 text-text-secondary hover:bg-red-100 hover:text-red-500 transition-colors"
                    onClick={() => deleteFile(file.id)}
                    disabled={file.isUploading}
                    title="删除文件"
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                </div>

                {/* 上传中取消按钮 */}
                {file.isUploading && (
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-bg-primary/60 p-0.5 text-text-secondary hover:bg-bg-primary/80 backdrop-blur-sm transition-colors"
                    onClick={() => deleteFile(file.id)}
                    title="取消上传"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 输入框和发送按钮 */}
      <div className="flex items-center gap-2">
        <textarea
          className="min-h-[44px] flex-1 rounded-2xl border border-border bg-bg-surface px-4 py-2 text-sm text-text-primary resize-none"
          rows={2}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="grid h-11 w-11 place-items-center rounded-full bg-accent text-white shadow-accent disabled:opacity-50 transition-opacity"
          onClick={handleSend}
          disabled={loading || disabled || hasUploadingFiles || (!query.trim() && uploadedFiles.length === 0)}
          title={hasUploadingFiles ? "等待上传完成..." : "发送"}
        >
          {hasUploadingFiles ? (
            <IconLoader className="h-5 w-5 animate-spin" />
          ) : (
            <IconSend className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
