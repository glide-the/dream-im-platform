import { NextRequest, NextResponse } from "next/server";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.withTag("storage-preview");

/**
 * Maximum file size for inline preview (100 MB).
 * Prevents excessive memory usage on preview proxy.
 */
const MAX_PREVIEW_SIZE = 100 * 1024 * 1024;
const BASE64_KEY_PREFIX = "b64_";

/**
 * Cache-Control header for successful responses.
 * Proxying arbitrary upstream URLs should avoid long-lived shared cache.
 */
const CACHE_CONTROL = "no-store";

function decodeBase64Url(encoded: string): string | null {
    if (!encoded) return null;
    try {
        const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        const decoded = Buffer.from(padded, "base64").toString("utf8");
        return decoded || null;
    } catch {
        return null;
    }
}

function decodeTargetUrl(rawKey: string): string | null {
    if (!rawKey) return null;

    let decoded = rawKey;
    if (rawKey.startsWith(BASE64_KEY_PREFIX)) {
        const encoded = rawKey.slice(BASE64_KEY_PREFIX.length);
        decoded = decodeBase64Url(encoded) ?? "";
    } else {
        // Backward compatibility: legacy urlencoded string
        try {
            decoded = decodeURIComponent(rawKey);
        } catch {
            return null;
        }
    }

    try {
        const parsed = new URL(decoded);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractFilenameFromUrl(targetUrl: string): string {
    try {
        const parsed = new URL(targetUrl);
        const pathname = decodeURIComponent(parsed.pathname);
        const filename = pathname.split("/").filter(Boolean).at(-1);
        return filename || "file";
    } catch {
        return "file";
    }
}

/**
 * GET /api/storage/file/[key]
 *
 * Public proxy endpoint for previewing/downloading files from upstream URLs.
 *
 * The [key] path segment carries the URL-safe base64 encoded source URL
 * (`b64_<encoded-url>`). The server decodes it, fetches the upstream URL
 * on the server network, and streams the response back to the browser.
 *
 * Query params:
 *   - download=1  Force Content-Disposition: attachment (browser download)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> },
) {
    const { key: rawKey } = await params;
    const targetUrl = decodeTargetUrl(rawKey);

    if (!targetUrl) {
        return NextResponse.json(
            { error: "Invalid source URL" },
            { status: 400 },
        );
    }

    const forceDownload = request.nextUrl.searchParams.get("download") === "1";

    try {
        const upstream = await fetch(targetUrl);
        if (!upstream.ok) {
            const status = upstream.status === 404 ? 404 : 502;
            return NextResponse.json(
                { error: "Failed to retrieve upstream file", status: upstream.status },
                { status },
            );
        }

        const contentLength = upstream.headers.get("content-length");
        const parsedContentLength = contentLength ? Number(contentLength) : NaN;
        if (Number.isFinite(parsedContentLength) && parsedContentLength > MAX_PREVIEW_SIZE) {
            return NextResponse.json(
                { error: "File too large for preview" },
                { status: 413 },
            );
        }

        const headers = new Headers();
        headers.set(
            "Content-Type",
            upstream.headers.get("content-type") || "application/octet-stream",
        );
        if (contentLength) {
            headers.set("Content-Length", contentLength);
        }
        headers.set("Cache-Control", CACHE_CONTROL);
        const upstreamAcceptRanges = upstream.headers.get("accept-ranges");
        if (upstreamAcceptRanges) {
            headers.set("Accept-Ranges", upstreamAcceptRanges);
        }

        const filename = extractFilenameFromUrl(targetUrl);
        const encodedFilename = encodeURIComponent(filename);

        if (forceDownload) {
            headers.set(
                "Content-Disposition",
                `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
            );
        } else {
            headers.set(
                "Content-Disposition",
                `inline; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
            );
        }

        // Security headers
        headers.set("X-Content-Type-Options", "nosniff");

        log.info(
            `Serving proxied file: ${targetUrl} (${headers.get("Content-Type")}, ${contentLength ?? "unknown"} bytes)`,
        );

        return new NextResponse(upstream.body, { status: 200, headers });
    } catch (error) {
        log.error(`Failed to proxy upstream url: ${targetUrl}`, error);
        return NextResponse.json(
            { error: "Failed to retrieve file" },
            { status: 500 },
        );
    }
}
