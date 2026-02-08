import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetMetadata = vi.fn();
const mockDownload = vi.fn();

function encodeKeySegment(key: string): string {
  const base64 = Buffer.from(key, "utf8").toString("base64");
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `k64_${base64url}`;
}

function decodeKeySegment(segment: string): string | null {
  if (!segment.startsWith("k64_")) return null;
  const encoded = segment.slice(4);
  if (!encoded) return null;

  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    if (!decoded || decoded.includes("..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

vi.mock("@/lib/file-storage", () => ({
  decodeStorageKeyFromBase64Segment: (segment: string) => decodeKeySegment(segment),
  serverFileStorage: {
    getMetadata: mockGetMetadata,
    download: mockDownload,
  },
}));

vi.mock("@/lib/logger", () => ({
  default: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

const importRoute = async () => import("./route");

describe("GET /api/storage/file/[...key]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves file by key with preview headers", async () => {
    mockGetMetadata.mockResolvedValue({
      key: "uploads/test.txt",
      filename: "test.txt",
      contentType: "text/plain",
      size: 11,
      uploadedAt: new Date("2026-02-08T00:00:00.000Z"),
    });
    mockDownload.mockResolvedValue(Buffer.from("hello world", "utf8"));

    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest(`http://localhost/api/storage/file/${encodeKeySegment("uploads/test.txt")}`),
      { params: Promise.resolve({ key: [encodeKeySegment("uploads/test.txt")] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(response.headers.get("Cache-Control")).toContain("max-age=300");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(response.headers.get("Content-Disposition")).toContain("test.txt");

    const body = Buffer.from(await response.arrayBuffer()).toString("utf8");
    expect(body).toBe("hello world");
  });

  it("serves download response when download=1", async () => {
    mockGetMetadata.mockResolvedValue({
      key: "uploads/test.txt",
      filename: "test.txt",
      contentType: "text/plain",
      size: 11,
      uploadedAt: new Date("2026-02-08T00:00:00.000Z"),
    });
    mockDownload.mockResolvedValue(Buffer.from("hello world", "utf8"));

    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest(`http://localhost/api/storage/file/${encodeKeySegment("uploads/test.txt")}?download=1`),
      { params: Promise.resolve({ key: [encodeKeySegment("uploads/test.txt")] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("serves unicode filenames with RFC5987-compatible header", async () => {
    const key = "uploads/纯粹理性批判.epub";
    mockGetMetadata.mockResolvedValue({
      key,
      filename: "纯粹理性批判.epub",
      contentType: "application/epub+zip",
      size: 8,
      uploadedAt: new Date("2026-02-08T00:00:00.000Z"),
    });
    mockDownload.mockResolvedValue(Buffer.from("epubdata", "utf8"));

    const { GET } = await importRoute();
    const encodedKey = encodeKeySegment(key);
    const response = await GET(
      new NextRequest(`http://localhost/api/storage/file/${encodedKey}?download=1`),
      { params: Promise.resolve({ key: [encodedKey] }) },
    );

    expect(response.status).toBe(200);
    const contentDisposition = response.headers.get("Content-Disposition");
    expect(contentDisposition).toContain("attachment");
    expect(contentDisposition).toContain(
      "filename*=UTF-8''%E7%BA%AF%E7%B2%B9%E7%90%86%E6%80%A7%E6%89%B9%E5%88%A4.epub",
    );
    expect(contentDisposition).not.toContain("纯粹理性批判.epub");
  });

  it("returns 400 when key is invalid", async () => {
    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest("http://localhost/api/storage/file/../secret.txt"),
      { params: Promise.resolve({ key: [".."] }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid file key" });
    expect(mockGetMetadata).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("returns 400 for URL-like key input (no URL compatibility mode)", async () => {
    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest("http://localhost/api/storage/file/https%3A%2F%2Fminio%2Flocal%2Ftest.txt"),
      { params: Promise.resolve({ key: ["https%3A%2F%2Fminio%2Flocal%2Ftest.txt"] }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid file key" });
    expect(mockGetMetadata).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("returns 404 when object does not exist", async () => {
    mockGetMetadata.mockResolvedValue(null);

    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest(`http://localhost/api/storage/file/${encodeKeySegment("uploads/missing.txt")}`),
      { params: Promise.resolve({ key: [encodeKeySegment("uploads/missing.txt")] }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "File not found" });
  });

  it("returns 500 when storage service fails", async () => {
    mockGetMetadata.mockRejectedValue(new Error("storage down"));

    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest(`http://localhost/api/storage/file/${encodeKeySegment("uploads/test.txt")}`),
      { params: Promise.resolve({ key: [encodeKeySegment("uploads/test.txt")] }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Storage service error" });
  });
});
