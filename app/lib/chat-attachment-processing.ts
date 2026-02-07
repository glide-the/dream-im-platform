import type { UIMessage } from "ai";
import type { ChatAttachment, WorkspaceFilePathPart } from "./chat-schema";
import {
  buildDocumentIngestionPreviewParts,
  type DocumentProcessingResult,
} from "./weknora";
import { syncAttachmentsToWorkspaceFiles } from "./workspace-file-sync";

export type AttachmentDerivedMessagePart =
  | { type: "text"; text: string }
  | WorkspaceFilePathPart;

export interface ProcessChatAttachmentsForMessageInput {
  attachments: ChatAttachment[];
  workspacePath: string;
  downloadFile: (url: string) => Promise<Blob>;
  buildPreviewParts?: (
    attachments: ChatAttachment[],
    downloadFile?: (url: string) => Promise<Blob>
  ) => Promise<DocumentProcessingResult[]>;
}

export interface ProcessChatAttachmentsForMessageResult {
  ingestionPreviewParts: DocumentProcessingResult[];
  workspaceFilePathParts: WorkspaceFilePathPart[];
  messageParts: AttachmentDerivedMessagePart[];
}

function createCachedDownloader(downloadFile: (url: string) => Promise<Blob>) {
  const cache = new Map<string, Promise<Blob>>();

  return (url: string): Promise<Blob> => {
    if (!cache.has(url)) {
      cache.set(url, downloadFile(url));
    }
    return cache.get(url)!;
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

  const [workspaceFilePathParts, ingestionPreviewParts] = await Promise.all([
    syncAttachmentsToWorkspaceFiles({
      workspacePath,
      attachments,
      downloadFile: cachedDownloader,
    }),
    buildPreviewParts(attachments, cachedDownloader),
  ]);

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
