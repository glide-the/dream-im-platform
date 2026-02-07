import { describe, it, expect, vi, beforeEach } from "vitest";

function encodeProxyKey(key: string): string {
    const base64 = Buffer.from(key, "utf8").toString("base64");
    const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `b64_${base64url}`;
}

describe("file-proxy", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("converts S3 URL to proxy URL", async () => {
        const { toFileProxyUrl } = await import("./file-proxy");
        const url = "https://mybucket.s3.us-east-1.amazonaws.com/uploads/abc-photo.png";
        expect(toFileProxyUrl(url)).toBe(
            `/api/storage/file/${encodeProxyKey(url)}`,
        );
    });

    it("converts MinIO URL to proxy URL", async () => {
        const { toFileProxyUrl } = await import("./file-proxy");
        const url = "http://minio:9000/mybucket/uploads/abc-photo.png";
        expect(toFileProxyUrl(url)).toBe(
            `/api/storage/file/${encodeProxyKey(url)}`,
        );
    });

    it("appends download=1 for download URL", async () => {
        const { toFileDownloadUrl } = await import("./file-proxy");
        const url = "https://mybucket.s3.us-east-1.amazonaws.com/uploads/report.pdf";
        expect(toFileDownloadUrl(url)).toBe(
            `/api/storage/file/${encodeProxyKey(url)}?download=1`,
        );
    });

    it("does not double-wrap already proxied URLs", async () => {
        const { toFileProxyUrl } = await import("./file-proxy");
        const proxyUrl = `/api/storage/file/${encodeProxyKey("https://example.com/uploads/photo.png")}`;
        expect(toFileProxyUrl(proxyUrl)).toBe(proxyUrl);
    });

    it("returns empty string for empty input", async () => {
        const { toFileProxyUrl } = await import("./file-proxy");
        expect(toFileProxyUrl("")).toBe("");
    });

    it("returns non-URL strings as-is", async () => {
        const { toFileProxyUrl } = await import("./file-proxy");
        expect(toFileProxyUrl("not-a-url")).toBe("not-a-url");
    });

    it("converts Vercel Blob URL to proxy URL", async () => {
        const { toFileProxyUrl } = await import("./file-proxy");
        const url = "https://store.public.blob.vercel-storage.com/uploads/file.pdf";
        expect(toFileProxyUrl(url)).toBe(
            `/api/storage/file/${encodeProxyKey(url)}`,
        );
    });
});
