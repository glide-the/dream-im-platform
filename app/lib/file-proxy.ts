/**
 * Client-side utility to convert object-storage keys to
 * the server-side preview/download endpoint (`/api/storage/file/[...key]`).
 *
 * WHY:  Object storage (S3 / MinIO) may listen on an internal network address
 *       that browsers on the public internet cannot reach. The Next.js backend
 *       uses the FileStorage service to fetch & stream the file to the client.
 *
 * Pass the storage *key* returned by the upload API and the
 * helper builds `/api/storage/file/<key>`.
 */
import { encodeStorageKeyToBase64Segment } from "./file-storage/storage-key";

const PROXY_PATH_PREFIX = "/api/storage/file/";

function withDownloadQuery(path: string): string {
    const [pathname, query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    params.set("download", "1");
    const queryString = params.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
}

/**
 * Convert a storage key to a preview-safe proxy path.
 *
 * - Storage key (preferred): `/api/storage/file/k64_<base64url(key)>`
 *   e.g. `uploads/abc-photo.png` → `/api/storage/file/k64_dXBsb2Fkcy9hYmMtcGhvdG8ucG5n`
 *
 * @param storageKey   Object storage key returned by upload APIs
 * @param download   If `true`, append `?download=1`
 */
export function toFileProxyUrl(storageKey: string, download = false): string {
    if (!storageKey) return storageKey;

    // Already a proxy URL — do not double-wrap
    if (storageKey.startsWith(PROXY_PATH_PREFIX)) {
        return download ? withDownloadQuery(storageKey) : storageKey;
    }

    const encodedKey = encodeStorageKeyToBase64Segment(storageKey);
    if (!encodedKey) return "";

    const base = `${PROXY_PATH_PREFIX}${encodedKey}`;
    return download ? `${base}?download=1` : base;
}

/**
 * Build a proxy download URL (with `Content-Disposition: attachment`).
 */
export function toFileDownloadUrl(storageKey: string): string {
    return toFileProxyUrl(storageKey, true);
}
