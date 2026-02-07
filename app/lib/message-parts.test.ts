import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { extractTextFromParts } from "./message-parts";

describe("extractTextFromParts", () => {
  it("joins text parts and appends file metadata", () => {
    const parts: UIMessage["parts"] = [
      { type: "text", text: "Summarize the attached report." },
      {
        type: "file",
        filename: "q4-report.pdf",
        mediaType: "application/pdf",
        size: 4096,
        url: "https://example.com/q4-report.pdf",
      },
    ];
    const result = extractTextFromParts(parts);

    expect(result).toContain("Summarize the attached report.");
    expect(result).toContain("Attached file: q4-report.pdf");
    expect(result).toContain("MIME type: application/pdf");
    expect(result).toContain("Size: 4.0 KB");
  });

  it("formats workspace-file part when message has no text", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "workspace-file",
        fileName: "notes.md",
        mimeType: "text/markdown",
        size: 1024,
        workspacePath: "files/notes.md",
        savedAt: "2026-02-07T22:00:00.000Z",
        hash: "abc123",
      },
    ];
    const result = extractTextFromParts(parts);

    expect(result).toContain("Workspace file: notes.md");
    expect(result).toContain("Path: files/notes.md");
    expect(result).toContain("Hash (sha256): abc123");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats source-url part", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "source-url",
        title: "Pricing page",
        url: "https://example.com/pricing",
      },
    ];
    const result = extractTextFromParts(parts);

    expect(result).toContain("Attached source: Pricing page");
    expect(result).toContain("URL: https://example.com/pricing");
  });
});
