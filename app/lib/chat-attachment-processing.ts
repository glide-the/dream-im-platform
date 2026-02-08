import type { UIMessage } from "ai";
import type { ChatAttachment, WorkspaceFilePathPart } from "./chat-schema";
import {
  buildDocumentIngestionPreviewParts,
  type DocumentProcessingResult,
} from "./weknora";
import {
  normalizeWorkspaceFileSyncError,
  syncAttachmentsToWorkspaceFiles,
  type WorkspaceFileSyncError,
} from "./workspace-file-sync";

export type AttachmentDerivedMessagePart =
  | { type: "text"; text: string }
  | WorkspaceFilePathPart;

export interface ProcessChatAttachmentsForMessageInput {
  attachments: ChatAttachment[];
  workspacePath: string;
  downloadFile: (url: string, storageKey?: string) => Promise<Blob>;
  buildPreviewParts?: (
    attachments: ChatAttachment[],
    downloadFile?: (url: string, storageKey?: string) => Promise<Blob>
  ) => Promise<DocumentProcessingResult[]>;
}

export interface ProcessChatAttachmentsForMessageResult {
  ingestionPreviewParts: DocumentProcessingResult[];
  workspaceFilePathParts: WorkspaceFilePathPart[];
  messageParts: AttachmentDerivedMessagePart[];
  workspaceSyncError?: WorkspaceFileSyncError;
}

function createCachedDownloader(downloadFile: (url: string, storageKey?: string) => Promise<Blob>) {
  const cache = new Map<string, Promise<Blob>>();

  return (url: string, storageKey?: string): Promise<Blob> => {
    const cacheKey = storageKey || url;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, downloadFile(url, storageKey));
    }
    return cache.get(cacheKey)!;
  };
}

export async function processChatAttachmentsForMessage({
  attachments,
  workspacePath,
  downloadFile,
  buildPreviewParts = buildDocumentIngestionPreviewParts,
}: ProcessChatAttachmentsForMessageInput): Promise<ProcessChatAttachmentsForMessageResult> {
  if (!attachments.length) {
    return {
      ingestionPreviewParts: [],
      workspaceFilePathParts: [],
      messageParts: [],
    };
  }

  const cachedDownloader = createCachedDownloader(downloadFile);

  // Keep preview-building call explicit to avoid accidental regression of the
  // WeKnora ingestion path during refactors.
  const ingestionPreviewParts = await buildPreviewParts(attachments, cachedDownloader);

  let workspaceSyncError: WorkspaceFileSyncError | undefined;
  let workspaceFilePathParts: WorkspaceFilePathPart[] = [];
  try {
    workspaceFilePathParts = await syncAttachmentsToWorkspaceFiles({
      workspacePath,
      attachments,
      downloadFile: cachedDownloader,
    });
  } catch (error) {
    workspaceSyncError = normalizeWorkspaceFileSyncError(error);
  }

  const messageParts: AttachmentDerivedMessagePart[] = [
    ...ingestionPreviewParts.map((result) => ({
      type: "text" as const,
      text: result.text,
    })),
    ...workspaceFilePathParts,
  ];

  return {
    ingestionPreviewParts,
    workspaceFilePathParts,
    messageParts,
    workspaceSyncError,
  };
}

export function injectAttachmentMessageParts(
  originalParts: UIMessage["parts"] | undefined,
  attachmentMessageParts: AttachmentDerivedMessagePart[]
): UIMessage["parts"] {
  const baseParts = [...(originalParts || [])];

  if (attachmentMessageParts.length === 0) {
    return baseParts;
  }

  let insertionIndex = -1;

  for (let index = baseParts.length - 1; index >= 0; index -= 1) {
    if (baseParts[index]?.type === "text") {
      insertionIndex = index;
      break;
    }
  }

  const partsToInject = attachmentMessageParts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text,
      };
    }

    return {
      ...part,
    } as unknown;
  });

  if (insertionIndex !== -1) {
    baseParts.splice(insertionIndex, 0, ...(partsToInject as UIMessage["parts"]));
    return baseParts;
  }

  return [...baseParts, ...(partsToInject as UIMessage["parts"])];
}
