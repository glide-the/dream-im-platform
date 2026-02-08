import { describe, it, expect, vi, beforeEach } from "vitest";

function encodeKeySegment(key: string): string {
  const base64 = Buffer.from(key, "utf8").toString("base64");
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `k64_${base64url}`;
}

describe("file-proxy", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("converts storage key to proxy URL", async () => {
    const { toFileProxyUrl } = await import("./file-proxy");
    const key = "uploads/abc-photo.png";
    expect(toFileProxyUrl(key)).toBe(
      `/api/storage/file/${encodeKeySegment(key)}`,
    );
  });

  it("encodes key as base64url segment", async () => {
    const { toFileProxyUrl } = await import("./file-proxy");
    const key = "uploads/report 2026#.pdf";
    expect(toFileProxyUrl(key)).toBe(
      `/api/storage/file/${encodeKeySegment(key)}`,
    );
  });

  it("builds download URL from storage key", async () => {
    const { toFileDownloadUrl } = await import("./file-proxy");
    const key = "uploads/abc-photo.png";
    expect(toFileDownloadUrl(key)).toBe(
      `/api/storage/file/${encodeKeySegment(key)}?download=1`,
    );
  });

  it("does not double-wrap already proxied URLs", async () => {
    const { toFileProxyUrl } = await import("./file-proxy");
    const proxyUrl = `/api/storage/file/${encodeKeySegment("uploads/abc-photo.png")}`;
    expect(toFileProxyUrl(proxyUrl)).toBe(proxyUrl);
  });

  it("appends download=1 to already proxied URLs", async () => {
    const { toFileDownloadUrl } = await import("./file-proxy");
    const proxyUrl = `/api/storage/file/${encodeKeySegment("uploads/abc-photo.png")}`;
    expect(toFileDownloadUrl(proxyUrl)).toBe(
      `${proxyUrl}?download=1`,
    );
  });

  it("returns empty string for empty input", async () => {
    const { toFileProxyUrl } = await import("./file-proxy");
    expect(toFileProxyUrl("")).toBe("");
  });

  it("returns empty string for invalid key", async () => {
    const { toFileProxyUrl } = await import("./file-proxy");
    expect(toFileProxyUrl("../etc/passwd")).toBe("");
  });
});
