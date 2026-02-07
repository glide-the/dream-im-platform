"use client";

import { memo } from "react";
import type { FileUIPart } from "ai";
import { IconFile, IconDownload } from "./Icons";
import { toFileProxyUrl, toFileDownloadUrl } from "@/lib/file-proxy";

/**
 * Props for FileMessagePart component
 */
interface FileMessagePartProps {
  /** File part from AI SDK */
  part: FileUIPart;
  /** Whether this is a user message (affects styling alignment) */
  isUserMessage: boolean;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * FileMessagePart - Renders file attachments in chat messages
 * 
 * Displays:
 * - Images: Full preview with optional filename caption
 * - Other files: Card with file icon, name, type badge, and download button
 * 
 * Styling adapts based on whether it's a user message (right-aligned, accent)
 * or assistant message (left-aligned, muted).
 */
export const FileMessagePart = memo(
  ({ part, isUserMessage }: FileMessagePartProps) => {
    const isImage = part.mediaType?.startsWith("image/");

    const fileExtension =
      part.filename?.split(".").pop()?.toUpperCase() ||
      part.mediaType?.split("/").pop()?.toUpperCase() ||
      "FILE";
    const rawUrl = part.url;
    const fileUrl = rawUrl ? toFileProxyUrl(rawUrl) : rawUrl;
    const downloadUrl = rawUrl ? toFileDownloadUrl(rawUrl) : rawUrl;
    const filename =
      part.filename || part.url?.split("/").pop() || "附件";
    const fileSize = (part as { size?: number }).size;
    const secondaryLabel =
      part.mediaType && part.mediaType !== "application/octet-stream"
        ? part.mediaType
        : undefined;

    // Image preview
    if (isImage && fileUrl) {
      return (
        <div
          className={`max-w-md rounded-lg overflow-hidden border border-border ${isUserMessage ? "ml-auto" : "mr-auto"
            }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl}
            alt={part.filename || "上传的图片"}
            className="w-full h-auto"
            loading="lazy"
          />
          {part.filename && (
            <div className="px-3 py-2 bg-bg-surface text-sm text-text-secondary">
              {part.filename}
            </div>
          )}
        </div>
      );
    }

    // Non-image file card
    return (
      <div
        className={`max-w-md rounded-2xl border p-4 shadow-sm ${isUserMessage
            ? "ml-auto bg-accent text-white border-accent/40"
            : "mr-auto bg-bg-surface text-text-primary border-border/80"
          }`}
      >
        <div className="flex items-start gap-4">
          {/* File icon */}
          <div
            className={`flex-shrink-0 rounded-xl p-3 ${isUserMessage ? "bg-white/10" : "bg-bg-secondary"
              }`}
          >
            <IconFile
              className={`h-6 w-6 ${isUserMessage ? "text-white/80" : "text-text-tertiary"
                }`}
            />
          </div>

          {/* File info */}
          <div className="flex-1 min-w-0 space-y-1 pr-3">
            <p
              className={`text-sm font-medium truncate ${isUserMessage ? "text-white" : "text-text-primary"
                }`}
              title={filename}
            >
              {filename}
            </p>
            <div
              className={`flex flex-wrap items-center gap-2 text-xs ${isUserMessage ? "text-white/70" : "text-text-tertiary"
                }`}
            >
              {/* File extension badge */}
              <span
                className={`uppercase tracking-wide px-2 py-0.5 rounded border ${isUserMessage
                    ? "border-white/30 text-white/90"
                    : "border-border text-text-secondary"
                  }`}
              >
                {fileExtension}
              </span>
              {/* File size */}
              {fileSize && (
                <span>{formatFileSize(fileSize)}</span>
              )}
              {/* MIME type */}
              {secondaryLabel && (
                <span
                  className="truncate max-w-[10rem]"
                  title={secondaryLabel}
                >
                  {secondaryLabel}
                </span>
              )}
            </div>
          </div>

          {/* Download button */}
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={part.filename ?? filename}
              className={`flex-shrink-0 p-2 rounded-full transition-colors ${isUserMessage
                  ? "text-white/70 hover:text-white hover:bg-white/10"
                  : "text-text-tertiary hover:text-text-primary hover:bg-bg-secondary"
                }`}
              title={`下载 ${filename}`}
            >
              <IconDownload className="h-5 w-5" />
              <span className="sr-only">下载 {filename}</span>
            </a>
          )}
        </div>
      </div>
    );
  }
);

FileMessagePart.displayName = "FileMessagePart";

export default FileMessagePart;
