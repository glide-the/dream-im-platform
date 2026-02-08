import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join, parse, relative, resolve } from "node:path";
import { z } from "zod";
import {
  type ChatAttachment,
  WorkspaceFilePathPartSchema,
  type WorkspaceFilePathPart,
} from "./chat-schema";
import { WORKSPACE_DIRS, writeWorkspaceFile } from "./workspace";

export const MAX_WORKSPACE_SYNC_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const WORKSPACE_ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/octet-stream",
]);

const WORKSPACE_ALLOWED_UPLOAD_MIME_PREFIXES = ["image/"];

export const WorkspaceFileSyncErrorCodeSchema = z.enum([
  "INVALID_ATTACHMENT",
  "INVALID_WORKSPACE_PATH",
  "FILE_TOO_LARGE",
  "MIME_TYPE_NOT_ALLOWED",
  "DOWNLOAD_FAILED",
  "WRITE_FAILED",
  "INTERNAL_ERROR",
]);

export type WorkspaceFileSyncErrorCode = z.infer<typeof WorkspaceFileSyncErrorCodeSchema>;

export class WorkspaceFileSyncError extends Error {
  code: WorkspaceFileSyncErrorCode;
  status: number;
  details?: unknown;

  constructor(code: WorkspaceFileSyncErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "WorkspaceFileSyncError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface SaveBufferToWorkspaceFilesInput {
  workspacePath: string;
  fileName?: string;
  mimeType?: string;
  content: Buffer;
}

export interface SyncAttachmentsToWorkspaceFilesInput {
  workspacePath: string;
  attachments: ChatAttachment[];
  downloadFile: (url: string, storageKey?: string) => Promise<Blob>;
}

function normalizeMimeType(mimeType?: string): string {
  return (mimeType || "application/octet-stream").trim().toLowerCase();
}

function isMimeTypeAllowed(mimeType: string): boolean {
  if (WORKSPACE_ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return WORKSPACE_ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function sanitizeUploadFileName(fileName?: string): string {
  const fallbackName = `upload-${Date.now()}`;
  const rawName = basename(fileName || "").trim() || fallbackName;
  const sanitized = rawName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");

  return sanitized || fallbackName;
}

function isPathInsideDirectory(basePath: string, targetPath: string): boolean {
  const pathRelative = relative(basePath, targetPath);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function normalizeWorkspaceRelativePath(workspacePath: string): string {
  return workspacePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveUniqueWorkspaceFilePath(workspacePath: string, fileName: string): string {
  const parsed = parse(fileName);
  let candidateName = fileName;
  let suffix = 1;

  while (existsSync(join(workspacePath, WORKSPACE_DIRS.FILES, candidateName))) {
    candidateName = `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }

  return `${WORKSPACE_DIRS.FILES}/${candidateName}`;
}

function resolveWorkspacePartFromAttachmentMetadata(
  workspacePath: string,
  attachment: ChatAttachment
): WorkspaceFilePathPart | null {
  if (!attachment.workspacePath) {
    return null;
  }

  const normalizedPath = normalizeWorkspaceRelativePath(attachment.workspacePath);
  const fullPath = resolve(join(workspacePath, normalizedPath));
  const filesRoot = resolve(join(workspacePath, WORKSPACE_DIRS.FILES));

  if (!isPathInsideDirectory(filesRoot, fullPath)) {
    throw new WorkspaceFileSyncError(
      "INVALID_WORKSPACE_PATH",
      "workspacePath must stay inside workspace files directory",
      400,
      { workspacePath: attachment.workspacePath }
    );
  }

  if (!existsSync(fullPath)) {
    return null;
  }

  const stats = statSync(fullPath);
  const savedAt = attachment.savedAt && !Number.isNaN(Date.parse(attachment.savedAt))
    ? new Date(attachment.savedAt).toISOString()
    : stats.mtime.toISOString();

  return WorkspaceFilePathPartSchema.parse({
    type: "workspace-file",
    fileName: attachment.filename || basename(normalizedPath),
    mimeType: normalizeMimeType(attachment.mediaType),
    size: attachment.size ?? stats.size,
    workspacePath: normalizedPath,
    savedAt,
    hash: attachment.hash,
  });
}

export function saveBufferToWorkspaceFiles({
  workspacePath,
  fileName,
  mimeType,
  content,
}: SaveBufferToWorkspaceFilesInput): WorkspaceFilePathPart {
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (!isMimeTypeAllowed(normalizedMimeType)) {
    throw new WorkspaceFileSyncError(
      "MIME_TYPE_NOT_ALLOWED",
      `File MIME type is not allowed: ${normalizedMimeType}`,
      400,
      { mimeType: normalizedMimeType }
    );
  }

  if (content.byteLength > MAX_WORKSPACE_SYNC_FILE_SIZE_BYTES) {
    throw new WorkspaceFileSyncError(
      "FILE_TOO_LARGE",
      `File exceeds max size limit (${MAX_WORKSPACE_SYNC_FILE_SIZE_BYTES} bytes)`,
      400,
      {
        maxSize: MAX_WORKSPACE_SYNC_FILE_SIZE_BYTES,
        actualSize: content.byteLength,
      }
    );
  }

  const sanitizedFileName = sanitizeUploadFileName(fileName);
  const workspaceRelativePath = resolveUniqueWorkspaceFilePath(workspacePath, sanitizedFileName);
  const savedAt = new Date().toISOString();
  const hash = createHash("sha256").update(content).digest("hex");

  try {
    writeWorkspaceFile(workspacePath, workspaceRelativePath, content);
  } catch (error) {
    throw new WorkspaceFileSyncError(
      "WRITE_FAILED",
      "Failed to save file into workspace",
      500,
      {
        fileName: sanitizedFileName,
        workspacePath: workspaceRelativePath,
        reason: error instanceof Error ? error.message : String(error),
      }
    );
  }

  return WorkspaceFilePathPartSchema.parse({
    type: "workspace-file",
    fileName: sanitizedFileName,
    mimeType: normalizedMimeType,
    size: content.byteLength,
    workspacePath: workspaceRelativePath,
    savedAt,
    hash,
  });
}

export async function syncAttachmentsToWorkspaceFiles({
  workspacePath,
  attachments,
  downloadFile,
}: SyncAttachmentsToWorkspaceFilesInput): Promise<WorkspaceFilePathPart[]> {
  const syncedParts: WorkspaceFilePathPart[] = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];

    if (attachment.type !== "file") {
      continue;
    }

    if (!attachment.url) {
      throw new WorkspaceFileSyncError(
        "INVALID_ATTACHMENT",
        "Attachment url is required for file sync",
        400,
        { index }
      );
    }

    const existingPart = resolveWorkspacePartFromAttachmentMetadata(workspacePath, attachment);
    if (existingPart) {
      syncedParts.push(existingPart);
      continue;
    }

    let downloadedBlob: Blob;
    try {
      downloadedBlob = await downloadFile(attachment.url, attachment.storageKey);
    } catch (error) {
      throw new WorkspaceFileSyncError(
        "DOWNLOAD_FAILED",
        "Failed to download attachment before workspace sync",
        502,
        {
          index,
          url: attachment.url,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
    }

    const blobBuffer = Buffer.from(await downloadedBlob.arrayBuffer());
    const inferredMimeType = normalizeMimeType(
      attachment.mediaType || downloadedBlob.type || "application/octet-stream"
    );

    try {
      const syncedPart = saveBufferToWorkspaceFiles({
        workspacePath,
        fileName: attachment.filename,
        mimeType: inferredMimeType,
        content: blobBuffer,
      });
      syncedParts.push(syncedPart);
    } catch (error) {
      if (error instanceof WorkspaceFileSyncError) {
        const errorDetails =
          typeof error.details === "object" && error.details !== null
            ? error.details
            : { details: error.details };
        throw new WorkspaceFileSyncError(
          error.code,
          error.message,
          error.status,
          {
            index,
            fileName: attachment.filename,
            mimeType: inferredMimeType,
            ...errorDetails,
          }
        );
      }

      throw new WorkspaceFileSyncError(
        "INTERNAL_ERROR",
        "Unexpected error while syncing file to workspace",
        500,
        {
          index,
          fileName: attachment.filename,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  return syncedParts;
}

export function normalizeWorkspaceFileSyncError(error: unknown): WorkspaceFileSyncError {
  if (error instanceof WorkspaceFileSyncError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new WorkspaceFileSyncError(
      "INVALID_ATTACHMENT",
      "Invalid workspace file part payload",
      400,
      { issues: error.issues }
    );
  }

  return new WorkspaceFileSyncError(
    "INTERNAL_ERROR",
    "Unexpected workspace file sync error",
    500,
    {
      reason: error instanceof Error ? error.message : String(error),
    }
  );
}
