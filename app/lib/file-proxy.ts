/**
 * Client-side utility to convert object-storage URLs to the server-side
 * preview proxy endpoint (`/api/storage/file/[key]`).
 *
 * WHY:  Object storage (S3 / MinIO) may listen on an internal network address
 *       that browsers on the public internet cannot reach. Routing through the
 *       server proxy allows the Next.js backend — which **can** reach the
 *       storage — to fetch and stream the file to the client.
 *
 * All file URLs are routed through the server proxy to guarantee browser
 * accessibility for private/internal storage endpoints.
 */
const BASE64_KEY_PREFIX = "b64_";

function toBase64Url(base64: string): string {
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeToBase64Url(value: string): string {
    const bytes = new TextEncoder().encode(value);

    // Node.js (tests / server-like runtimes)
    if (typeof Buffer !== "undefined") {
        const base64 = Buffer.from(bytes).toString("base64");
        return toBase64Url(base64);
    }

    // Browser fallback
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return toBase64Url(btoa(binary));
}

/**
 * Normalize and validate a source URL.
 */
function normalizeSourceUrl(url: string): string | null {
    try {
        return new URL(url).toString();
    } catch {
        return null;
    }
}

/**
 * Convert a raw file URL to a preview-safe URL.
 *
 * Returns `/api/storage/file/<encodedUrl>` (proxy path).
 *
 * @param url         Raw object-storage URL (e.g. from `UploadResult.sourceUrl`)
 * @param download    If `true`, append `?download=1` to force browser download
 */
export function toFileProxyUrl(url: string, download = false): string {
    if (!url) return url;

    // Already a proxy URL — do not double-wrap
    if (url.startsWith("/api/storage/file/")) return url;

    const normalizedUrl = normalizeSourceUrl(url);
    if (!normalizedUrl) return url; // fallback: unrecognized URL format

    const encoded = `${BASE64_KEY_PREFIX}${encodeToBase64Url(normalizedUrl)}`;
    const base = `/api/storage/file/${encoded}`;
    return download ? `${base}?download=1` : base;
}

/**
 * Build a proxy download URL (with `Content-Disposition: attachment`).
 */
export function toFileDownloadUrl(url: string): string {
    return toFileProxyUrl(url, true);
}
