"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconFolder, IconFile, IconTrash, IconPlus, IconLoader, IconChevronRight, IconChevronDown, IconX } from "../Icons";

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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function FileSidebar({ sessionId, open, onClose }: FileSidebarProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async (subPath: string = "") => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ sessionId });
      if (subPath) params.set("path", subPath);
      const res = await fetch(`/api/workspace/files?${params}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error("Failed to fetch files:", error);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (open && sessionId) {
      fetchFiles(currentPath);
    }
  }, [open, sessionId, currentPath, fetchFiles]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !sessionId) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("sessionId", sessionId);
      if (currentPath) formData.set("path", currentPath);
      for (let i = 0; i < fileList.length; i++) {
        formData.append("file", fileList[i]);
      }

      const res = await fetch("/api/workspace/files", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        await fetchFiles(currentPath);
      }
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
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

  const breadcrumbs = ["workspace", ...currentPath.split("/").filter(Boolean)];

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={`fixed inset-0 z-30 bg-black/30 md:hidden ${open ? "block" : "hidden"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed right-0 top-0 z-40 flex h-full w-[320px] flex-col border-l border-[var(--neutral-border)] bg-white transition-transform duration-300 md:static md:z-auto ${
          open ? "translate-x-0" : "translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden md:border-l-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--neutral-border)] px-4 py-3">
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
              {uploading ? (
                <IconLoader className="h-4 w-4 animate-spin" />
              ) : (
                <IconPlus className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-secondary md:hidden"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 border-b border-[var(--neutral-border)] px-4 py-2 text-xs text-text-tertiary">
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

        {/* File list */}
        <div
          className={`flex-1 overflow-y-auto ${dragOver ? "bg-orange-50 ring-2 ring-inset ring-accent-orange" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
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
              <p className="mt-1 text-xs">Upload files or drag & drop here</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--neutral-border)]">
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
                  <div className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg-secondary">
                    {file.isDirectory ? (
                      <button
                        onClick={() => toggleDir(file.path)}
                        className="flex flex-1 items-center gap-2"
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
                      <div className="flex flex-1 items-center gap-2">
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
                      className="rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
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

        {/* Upload zone / drop target hint */}
        <div className="border-t border-[var(--neutral-border)] p-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-4 py-3 text-sm text-text-tertiary transition-colors hover:border-accent-orange hover:text-accent-orange"
            disabled={uploading}
          >
            {uploading ? (
              <>
                <IconLoader className="h-4 w-4 animate-spin" /> Uploading...
              </>
            ) : (
              <>
                <IconPlus className="h-4 w-4" /> Upload files
              </>
            )}
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </aside>
    </>
  );
}
