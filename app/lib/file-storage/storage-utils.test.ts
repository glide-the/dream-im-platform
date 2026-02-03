import { describe, expect, it } from "vitest";
import { 
  storageKeyFromUrl, 
  sanitizeFilename, 
  getContentTypeFromFilename,
  resolveStoragePrefix,
  toBuffer 
} from "./storage-utils";

describe("storageKeyFromUrl", () => {
  it("extracts key from absolute URL", () => {
    expect(storageKeyFromUrl("https://example.com/uploads/sample.csv")).toBe(
      "uploads/sample.csv",
    );
  });

  it("decodes encoded path segments", () => {
    expect(
      storageKeyFromUrl(
        "https://example.com/uploads/My%20File%20(1).csv?token=123",
      ),
    ).toBe("uploads/My File (1).csv");
  });

  it("returns null for invalid URLs", () => {
    expect(storageKeyFromUrl("not-a-url")).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("removes unsafe characters", () => {
    expect(sanitizeFilename("my file (1).txt")).toBe("my_file__1_.txt");
  });

  it("extracts basename from paths", () => {
    expect(sanitizeFilename("/path/to/file.txt")).toBe("file.txt");
    expect(sanitizeFilename("path\\to\\file.txt")).toBe("file.txt");
  });

  it("returns 'file' for empty input", () => {
    expect(sanitizeFilename("")).toBe("file");
  });

  it("handles filenames with special characters", () => {
    expect(sanitizeFilename("test@#$%.txt")).toBe("test____.txt");
  });

  it("preserves alphanumeric, dots, underscores, and hyphens", () => {
    expect(sanitizeFilename("test-file_123.txt")).toBe("test-file_123.txt");
  });
});

describe("getContentTypeFromFilename", () => {
  it("returns correct MIME type for images", () => {
    expect(getContentTypeFromFilename("photo.jpg")).toBe("image/jpeg");
    expect(getContentTypeFromFilename("photo.jpeg")).toBe("image/jpeg");
    expect(getContentTypeFromFilename("photo.png")).toBe("image/png");
    expect(getContentTypeFromFilename("photo.gif")).toBe("image/gif");
    expect(getContentTypeFromFilename("photo.webp")).toBe("image/webp");
    expect(getContentTypeFromFilename("icon.svg")).toBe("image/svg+xml");
  });

  it("returns correct MIME type for documents", () => {
    expect(getContentTypeFromFilename("doc.pdf")).toBe("application/pdf");
    expect(getContentTypeFromFilename("doc.doc")).toBe("application/msword");
    expect(getContentTypeFromFilename("spreadsheet.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("returns correct MIME type for text files", () => {
    expect(getContentTypeFromFilename("file.txt")).toBe("text/plain");
    expect(getContentTypeFromFilename("data.json")).toBe("application/json");
    expect(getContentTypeFromFilename("page.html")).toBe("text/html");
    expect(getContentTypeFromFilename("data.csv")).toBe("text/csv");
    expect(getContentTypeFromFilename("readme.md")).toBe("text/markdown");
  });

  it("returns correct MIME type for audio/video", () => {
    expect(getContentTypeFromFilename("audio.mp3")).toBe("audio/mpeg");
    expect(getContentTypeFromFilename("video.mp4")).toBe("video/mp4");
    expect(getContentTypeFromFilename("video.webm")).toBe("video/webm");
  });

  it("returns correct MIME type for archives", () => {
    expect(getContentTypeFromFilename("archive.zip")).toBe("application/zip");
    expect(getContentTypeFromFilename("archive.tar")).toBe("application/x-tar");
    expect(getContentTypeFromFilename("archive.gz")).toBe("application/gzip");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(getContentTypeFromFilename("file.xyz")).toBe("application/octet-stream");
    expect(getContentTypeFromFilename("file")).toBe("application/octet-stream");
    expect(getContentTypeFromFilename("")).toBe("application/octet-stream");
  });

  it("handles uppercase extensions", () => {
    expect(getContentTypeFromFilename("photo.PNG")).toBe("image/png");
    expect(getContentTypeFromFilename("photo.JPEG")).toBe("image/jpeg");
  });
});

describe("resolveStoragePrefix", () => {
  const originalEnv = process.env.FILE_STORAGE_PREFIX;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.FILE_STORAGE_PREFIX = originalEnv;
    } else {
      delete process.env.FILE_STORAGE_PREFIX;
    }
  });

  it("returns default 'uploads' when no env var set", () => {
    delete process.env.FILE_STORAGE_PREFIX;
    expect(resolveStoragePrefix()).toBe("uploads");
  });

  it("strips leading and trailing slashes", () => {
    process.env.FILE_STORAGE_PREFIX = "/custom/path/";
    expect(resolveStoragePrefix()).toBe("custom/path");
  });

  it("strips leading and trailing dots and slashes", () => {
    process.env.FILE_STORAGE_PREFIX = "../uploads/";
    expect(resolveStoragePrefix()).toBe("uploads");
  });

  it("preserves dots within path", () => {
    process.env.FILE_STORAGE_PREFIX = "my.folder/uploads";
    expect(resolveStoragePrefix()).toBe("my.folder/uploads");
  });
});

describe("toBuffer", () => {
  it("returns Buffer unchanged", async () => {
    const buffer = Buffer.from("hello");
    const result = await toBuffer(buffer);
    expect(result).toBe(buffer);
  });

  it("converts ArrayBuffer to Buffer", async () => {
    const text = "hello";
    const arrayBuffer = new TextEncoder().encode(text).buffer;
    const result = await toBuffer(arrayBuffer);
    expect(result.toString()).toBe(text);
  });

  it("converts Uint8Array to Buffer", async () => {
    const text = "hello";
    const uint8 = new TextEncoder().encode(text);
    const result = await toBuffer(uint8);
    expect(result.toString()).toBe(text);
  });

  it("throws for unsupported types", async () => {
    await expect(toBuffer(123 as never)).rejects.toThrow("Unsupported upload content type");
  });
});
