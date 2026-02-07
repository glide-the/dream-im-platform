import type { UIMessage } from "ai";

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inferFileNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").pop();
    return name ? decodeURIComponent(name) : undefined;
  } catch {
    const [withoutQuery] = url.split("?");
    const name = withoutQuery.split("/").pop();
    return name ? decodeURIComponent(name) : undefined;
  }
}

function formatFilePart(part: Record<string, unknown>): string {
  const url = readString(part.url);
  const fileName = readString(part.filename) || inferFileNameFromUrl(url) || "Unnamed file";
  const mediaType = readString(part.mediaType);
  const size = readNonNegativeNumber(part.size);

  const lines = [`Attached file: ${fileName}`];

  if (mediaType) {
    lines.push(`MIME type: ${mediaType}`);
  }

  if (size !== undefined) {
    lines.push(`Size: ${formatSize(size)}`);
  }

  if (url) {
    lines.push(`URL: ${url}`);
  }

  return lines.join("\n");
}

function formatSourceUrlPart(part: Record<string, unknown>): string | null {
  const url = readString(part.url);
  if (!url) return null;

  const title = readString(part.title);
  const mediaType = readString(part.mediaType);
  const lines = [title ? `Attached source: ${title}` : "Attached source URL", `URL: ${url}`];

  if (mediaType) {
    lines.push(`MIME type: ${mediaType}`);
  }

  return lines.join("\n");
}

function formatWorkspaceFilePart(part: Record<string, unknown>): string {
  const fileName = readString(part.fileName) || "Unnamed workspace file";
  const workspacePath = readString(part.workspacePath);
  const mimeType = readString(part.mimeType);
  const savedAt = readString(part.savedAt);
  const hash = readString(part.hash);
  const size = readNonNegativeNumber(part.size);

  const lines = [`Workspace file: ${fileName}`];

  if (workspacePath) {
    lines.push(`Path: ${workspacePath}`);
  }

  if (mimeType) {
    lines.push(`MIME type: ${mimeType}`);
  }

  if (size !== undefined) {
    lines.push(`Size: ${formatSize(size)}`);
  }

  if (savedAt) {
    lines.push(`Saved at: ${savedAt}`);
  }

  if (hash) {
    lines.push(`Hash (sha256): ${hash}`);
  }

  return lines.join("\n");
}

/**
 * Extract text content from UIMessage parts for agent input.
 * Includes metadata from file-related parts so attachment-only messages are still actionable.
 */
export function extractTextFromParts(
  parts: UIMessage["parts"] | undefined,
  separator: string = "\n\n"
): string {
  if (!parts || !Array.isArray(parts)) return "";

  const textContents: string[] = [];
  const attachmentContents: string[] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const partRecord = part as Record<string, unknown>;

    if (partRecord.type === "text") {
      const text = readString(partRecord.text);
      if (text) {
        textContents.push(text);
      }
      continue;
    }

    if (partRecord.type === "file") {
      attachmentContents.push(formatFilePart(partRecord));
      continue;
    }

    if (partRecord.type === "source-url") {
      const sourceContent = formatSourceUrlPart(partRecord);
      if (sourceContent) {
        attachmentContents.push(sourceContent);
      }
      continue;
    }

    if (partRecord.type === "workspace-file") {
      attachmentContents.push(formatWorkspaceFilePart(partRecord));
    }
  }

  return [...textContents, ...attachmentContents].join(separator).trim();
}
