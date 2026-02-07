import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment } from "./chat-schema";
import {
  buildDocumentIngestionPreviewParts,
  WeKnoraClient,
  type WeKnoraChunk,
  type WeKnoraKnowledge,
} from "./weknora";

function createKnowledge(overrides?: Partial<WeKnoraKnowledge>): WeKnoraKnowledge {
  return {
    id: "knowledge-1",
    tenant_id: 1,
    knowledge_base_id: "kb-00000001",
    type: "file",
    title: "Test Knowledge",
    description: "Test",
    source: "upload",
    parse_status: "completed",
    enable_status: "enabled",
    file_name: "brief.txt",
    file_type: "text/plain",
    file_size: 12,
    created_at: "2026-02-07T00:00:00.000Z",
    updated_at: "2026-02-07T00:00:00.000Z",
    ...overrides,
  };
}

function createChunk(index: number, content: string): WeKnoraChunk {
  return {
    id: `chunk-${index}`,
    tenant_id: 1,
    knowledge_id: "knowledge-1",
    knowledge_base_id: "kb-00000001",
    content,
    chunk_index: index,
    is_enabled: true,
    status: 1,
    start_at: 0,
    end_at: content.length,
    chunk_type: "text",
    created_at: "2026-02-07T00:00:00.000Z",
    updated_at: "2026-02-07T00:00:00.000Z",
  };
}

describe("buildDocumentIngestionPreviewParts", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds preview text for supported file attachments", async () => {
    const attachments: ChatAttachment[] = [
      {
        type: "file",
        url: "https://example.com/brief.txt",
        mediaType: "text/plain",
        filename: "brief.txt",
      },
    ];

    const downloadFile = vi
      .fn<(url: string) => Promise<Blob>>()
      .mockResolvedValue(new Blob(["hello"], { type: "text/plain" }));

    vi.spyOn(WeKnoraClient.prototype, "isConfigured").mockReturnValue(true);
    vi.spyOn(WeKnoraClient.prototype, "createKnowledgeFromFile").mockResolvedValue(
      createKnowledge({ parse_status: "pending" })
    );
    vi.spyOn(WeKnoraClient.prototype, "waitForProcessing").mockResolvedValue(
      createKnowledge({ parse_status: "completed" })
    );
    vi.spyOn(WeKnoraClient.prototype, "getChunks").mockResolvedValue({
      chunks: [createChunk(1, "second"), createChunk(0, "first")],
      total: 2,
    });

    const results = await buildDocumentIngestionPreviewParts(attachments, downloadFile);

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.knowledgeId).toBe("knowledge-1");
    expect(results[0]?.text).toContain("--- Document: brief.txt ---");
    expect(results[0]?.text).toContain("first");
    expect(results[0]?.text).toContain("second");
    expect(results[0]?.text).toContain("--- End of Document (2 chunks) ---");
  });

  it("returns empty previews when WeKnora processing fails", async () => {
    const attachments: ChatAttachment[] = [
      {
        type: "file",
        url: "https://example.com/fail.txt",
        mediaType: "text/plain",
        filename: "fail.txt",
      },
    ];

    const downloadFile = vi
      .fn<(url: string) => Promise<Blob>>()
      .mockResolvedValue(new Blob(["hello"], { type: "text/plain" }));

    vi.spyOn(WeKnoraClient.prototype, "isConfigured").mockReturnValue(true);
    vi.spyOn(WeKnoraClient.prototype, "createKnowledgeFromFile").mockRejectedValue(
      new Error("service unavailable")
    );

    const results = await buildDocumentIngestionPreviewParts(attachments, downloadFile);

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
