import { createId } from "./id";

export type WorkspaceUploadSource = "drag" | "file-picker" | "folder-picker";
export type WorkspaceUploadStatus = "pending" | "uploading" | "success" | "error";

export interface WorkspaceUploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  relativePath: string;
  source: WorkspaceUploadSource;
  status: WorkspaceUploadStatus;
  error?: string;
}

export interface WorkspaceUploadLimits {
  maxFiles: number;
  maxTotalBytes: number;
}

export interface WorkspaceUploadCollectOptions {
  limits?: Partial<WorkspaceUploadLimits>;
  yieldEvery?: number;
}

export interface WorkspaceUploadCollectResult {
  items: WorkspaceUploadItem[];
  errors: string[];
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

interface DataTransferItemWithEntry extends DataTransferItem {
  webkitGetAsEntry: () => FileSystemEntry | null;
}

const DEFAULT_YIELD_EVERY = 40;

export const DEFAULT_WORKSPACE_UPLOAD_LIMITS: WorkspaceUploadLimits = {
  maxFiles: 2000,
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GB
};

function resolveLimits(
  limits?: Partial<WorkspaceUploadLimits>,
): WorkspaceUploadLimits {
  return {
    maxFiles: limits?.maxFiles ?? DEFAULT_WORKSPACE_UPLOAD_LIMITS.maxFiles,
    maxTotalBytes:
      limits?.maxTotalBytes ?? DEFAULT_WORKSPACE_UPLOAD_LIMITS.maxTotalBytes,
  };
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function joinRelativePath(prefix: string, name: string): string {
  if (!prefix) return name;
  return `${prefix}/${name}`;
}

export function normalizeUploadRelativePath(rawPath: string): string {
  const normalized = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");

  if (!normalized) {
    return "";
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    return "";
  }

  return normalized;
}

function getFileRelativePath(file: File, fallbackPath: string): string {
  const webkitRelativePath = file.webkitRelativePath;
  if (typeof webkitRelativePath === "string" && webkitRelativePath.trim()) {
    const normalized = normalizeUploadRelativePath(webkitRelativePath);
    if (normalized) {
      return normalized;
    }
  }

  return normalizeUploadRelativePath(fallbackPath) || file.name;
}

function createUploadItem(
  file: File,
  relativePath: string,
  source: WorkspaceUploadSource,
): WorkspaceUploadItem {
  return {
    id: createId("upload"),
    file,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    relativePath,
    source,
    status: "pending",
  };
}

function dedupeUploadItems(items: WorkspaceUploadItem[]): WorkspaceUploadItem[] {
  const seen = new Set<string>();
  const deduped: WorkspaceUploadItem[] = [];

  for (const item of items) {
    const dedupeKey = `${item.relativePath}|${item.size}|${item.file.lastModified}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(item);
  }

  return deduped;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function applyUploadLimits(
  items: WorkspaceUploadItem[],
  limits: WorkspaceUploadLimits,
): WorkspaceUploadCollectResult {
  const accepted: WorkspaceUploadItem[] = [];
  const errors: string[] = [];

  let totalBytes = 0;
  let droppedByCount = 0;
  let droppedBySize = 0;

  for (const item of items) {
    if (accepted.length >= limits.maxFiles) {
      droppedByCount += 1;
      continue;
    }

    if (totalBytes + item.size > limits.maxTotalBytes) {
      droppedBySize += 1;
      continue;
    }

    accepted.push(item);
    totalBytes += item.size;
  }

  if (droppedByCount > 0) {
    errors.push(
      `超出文件数量限制（最多 ${limits.maxFiles} 个），已忽略 ${droppedByCount} 个文件。`,
    );
  }

  if (droppedBySize > 0) {
    errors.push(
      `超出总大小限制（最多 ${formatBytes(
        limits.maxTotalBytes,
      )}），已忽略 ${droppedBySize} 个文件。`,
    );
  }

  return { items: accepted, errors };
}

export async function collectUploadItemsFromFileSelection(
  files: FileList | readonly File[],
  source: WorkspaceUploadSource,
  options?: WorkspaceUploadCollectOptions,
): Promise<WorkspaceUploadCollectResult> {
  const list = Array.from(files);
  if (list.length === 0) {
    return { items: [], errors: [] };
  }

  const yieldEvery = options?.yieldEvery ?? DEFAULT_YIELD_EVERY;
  const items: WorkspaceUploadItem[] = [];

  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    const relativePath = getFileRelativePath(file, file.name);

    if (!relativePath) {
      continue;
    }

    items.push(createUploadItem(file, relativePath, source));

    if ((index + 1) % yieldEvery === 0) {
      await waitForNextTick();
    }
  }

  return applyUploadLimits(items, resolveLimits(options?.limits));
}

function hasWebkitEntrySupport(
  item: DataTransferItem,
): item is DataTransferItemWithEntry {
  return typeof (item as Partial<DataTransferItemWithEntry>).webkitGetAsEntry === "function";
}

function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(file),
      (error) => reject(error ?? new Error("读取文件失败")),
    );
  });
}

function readDirectoryEntries(
  entry: FileSystemDirectoryEntryLike,
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();
    const entries: FileSystemEntryLike[] = [];

    const readAll = () => {
      reader.readEntries(
        (chunk) => {
          if (!chunk.length) {
            resolve(entries);
            return;
          }
          entries.push(...chunk);
          readAll();
        },
        (error) => {
          reject(error ?? new Error("读取目录失败"));
        },
      );
    };

    readAll();
  });
}

async function collectUploadItemsFromEntries(
  roots: Array<{ entry: FileSystemEntryLike; relativePath: string }>,
  source: WorkspaceUploadSource,
  yieldEvery: number,
): Promise<WorkspaceUploadCollectResult> {
  const queue = [...roots];
  const items: WorkspaceUploadItem[] = [];
  const errors: string[] = [];
  let processed = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    try {
      if (current.entry.isFile) {
        const file = await readFileEntry(current.entry as FileSystemFileEntryLike);
        const relativePath =
          normalizeUploadRelativePath(current.relativePath) ||
          normalizeUploadRelativePath(file.name);
        if (!relativePath) {
          errors.push(`忽略非法路径文件：${file.name}`);
          continue;
        }
        items.push(createUploadItem(file, relativePath, source));
      } else if (current.entry.isDirectory) {
        const children = await readDirectoryEntries(
          current.entry as FileSystemDirectoryEntryLike,
        );
        for (const child of children) {
          queue.push({
            entry: child,
            relativePath: joinRelativePath(current.relativePath, child.name),
          });
        }
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "无法读取拖拽文件项";
      errors.push(`${current.relativePath}: ${reason}`);
    }

    processed += 1;
    if (processed % yieldEvery === 0) {
      await waitForNextTick();
    }
  }

  return { items, errors };
}

export async function collectUploadItemsFromDrop(
  dataTransfer: Pick<DataTransfer, "items" | "files">,
  options?: WorkspaceUploadCollectOptions,
): Promise<WorkspaceUploadCollectResult> {
  const droppedItems = Array.from(dataTransfer.items ?? []);
  const droppedFiles = Array.from(dataTransfer.files ?? []);
  const yieldEvery = options?.yieldEvery ?? DEFAULT_YIELD_EVERY;
  const limits = resolveLimits(options?.limits);
  const errors: string[] = [];

  const itemsWithEntrySupport = droppedItems.filter(hasWebkitEntrySupport);
  if (itemsWithEntrySupport.length > 0) {
    const roots: Array<{ entry: FileSystemEntryLike; relativePath: string }> =
      [];
    const fallbackItems: WorkspaceUploadItem[] = [];
    let droppedDirectoryCount = 0;

    for (const item of itemsWithEntrySupport) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) {
        const fallbackFile = item.getAsFile();
        if (fallbackFile) {
          const fallbackPath = getFileRelativePath(
            fallbackFile,
            fallbackFile.name,
          );
          if (fallbackPath) {
            fallbackItems.push(
              createUploadItem(fallbackFile, fallbackPath, "drag"),
            );
          }
        }
        continue;
      }

      if (entry.isDirectory) {
        droppedDirectoryCount += 1;
      }

      roots.push({
        entry,
        relativePath: normalizeUploadRelativePath(entry.name) || entry.name,
      });
    }

    const collected = await collectUploadItemsFromEntries(
      roots,
      "drag",
      yieldEvery,
    );
    let mergedItems = [...collected.items, ...fallbackItems];
    let mergedErrors = [...errors, ...collected.errors];

    // Fallback path:
    // Some environments fail while reading entries (e.g. transient OS file access
    // errors) but still expose files via dataTransfer.files. In that case, retry
    // from droppedFiles so users do not get a false "empty directory" result.
    if (mergedItems.length === 0 && droppedFiles.length > 0) {
      const fallbackFromFiles = await collectUploadItemsFromFileSelection(
        droppedFiles,
        "drag",
        options,
      );
      mergedItems = [...mergedItems, ...fallbackFromFiles.items];
      mergedErrors = [...mergedErrors, ...fallbackFromFiles.errors];
    }

    mergedItems = dedupeUploadItems(mergedItems);
    const limited = applyUploadLimits(mergedItems, limits);

    if (
      droppedDirectoryCount > 0 &&
      limited.items.length === 0 &&
      mergedErrors.length === 0
    ) {
      errors.push("拖拽目录为空，未发现可上传文件。");
    }

    return {
      items: limited.items,
      errors: [
        ...errors,
        ...mergedErrors,
        ...limited.errors,
      ],
    };
  }

  if (droppedFiles.length > 0) {
    const selectionResult = await collectUploadItemsFromFileSelection(
      droppedFiles,
      "drag",
      options,
    );
    return selectionResult;
  }

  if (droppedItems.length > 0) {
    return {
      items: [],
      errors: [
        "当前浏览器不支持拖拽文件夹解析，请使用“选择文件夹”按钮上传目录。",
      ],
    };
  }

  return { items: [], errors: [] };
}
