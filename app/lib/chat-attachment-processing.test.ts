import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { ChatAttachment } from "./chat-schema";
import {
  injectAttachmentMessageParts,
  processChatAttachmentsForMessage,
} from "./chat-attachment-processing";
import { initWorkspace } from "./workspace";
import { WorkspaceFileSyncError } from "./workspace-file-sync";

const TEST_WORKSPACE_ROOT = join(
  tmpdir(),
  `chat-attachment-processing-test-${randomUUID()}`
);

describe("chat attachment processing", () => {
  beforeEach(() => {
    process.env.AGENT_CWD = TEST_WORKSPACE_ROOT;
    if (existsSync(TEST_WORKSPACE_ROOT)) {
      rmSync(TEST_WORKSPACE_ROOT, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_WORKSPACE_ROOT)) {
      rmSync(TEST_WORKSPACE_ROOT, { recursive: true });
    }
    delete process.env.AGENT_CWD;
  });

  it("processes attachment and returns document preview + workspace file path parts", async () => {
    const workspacePath = initWorkspace("sync-success");
    const attachments: ChatAttachment[] = [
      {
        type: "file",
        url: "https://example.com/brief.txt",
        filename: "brief.txt",
        mediaType: "text/plain",
      },
    ];

    const result = await processChatAttachmentsForMessage({
      attachments,
      workspacePath,
      downloadFile: async () => new Blob(["hello workspace"], { type: "text/plain" }),
      buildPreviewParts: async () => [
        {
          type: "text",
          text: "--- Document: brief.txt ---\npreview\n--- End ---",
          ingestionPreview: true,
          knowledgeId: "kb-test-1",
          fileName: "brief.txt",
        },
      ],
    });

    expect(result.ingestionPreviewParts).toHaveLength(1);
    expect(result.workspaceFilePathParts).toHaveLength(1);
    expect(result.messageParts).toHaveLength(2);
    expect(result.messageParts[0]).toMatchObject({ type: "text" });
    expect(result.messageParts[1]).toMatchObject({ type: "workspace-file" });

    const workspacePart = result.workspaceFilePathParts[0];
    expect(workspacePart.workspacePath.startsWith("files/")).toBe(true);
    expect(workspacePart.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(workspacePath, workspacePart.workspacePath))).toBe(true);

    const injected = injectAttachmentMessageParts(
      [{ type: "text", text: "用户消息" }],
      result.messageParts
    );
    expect(injected).toHaveLength(3);
    expect(injected[0]).toMatchObject({ type: "text" });
    expect((injected[1] as { type: string }).type).toBe("workspace-file");
    expect(injected[2]).toMatchObject({ type: "text", text: "用户消息" });
  });

  it("returns workspace sync error but keeps message flow when attachment mime type is not allowed", async () => {
    const workspacePath = initWorkspace("sync-fail");
    const attachments: ChatAttachment[] = [
      {
        type: "file",
        url: "https://example.com/malware.exe",
        filename: "malware.exe",
        mediaType: "application/x-msdownload",
      },
    ];

    const result = await processChatAttachmentsForMessage({
      attachments,
      workspacePath,
      downloadFile: async () =>
        new Blob(["binary"], { type: "application/x-msdownload" }),
      buildPreviewParts: async () => [],
    });

    expect(result.ingestionPreviewParts).toEqual([]);
    expect(result.workspaceFilePathParts).toEqual([]);
    expect(result.messageParts).toEqual([]);
    expect(result.workspaceSyncError).toMatchObject<Partial<WorkspaceFileSyncError>>({
      code: "MIME_TYPE_NOT_ALLOWED",
      status: 400,
    });
  });
});
