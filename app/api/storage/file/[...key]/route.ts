import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  decodeStorageKeyFromBase64Segment,
  serverFileStorage,
} from "@/lib/file-storage";
import { FileNotFoundError } from "@/lib/errors";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.withTag("storage-file");
const CACHE_CONTROL = "private, max-age=300, stale-while-revalidate=300";

const StorageFileRouteParamsSchema = z.object({
  key: z.array(z.string().min(1)).length(1),
});

function extractFilenameFromKey(key: string): string {
  const basename = key.split("/").filter(Boolean).at(-1) || "file";
  // Strip UUID prefix if present (pattern: uuid-filename.ext)
  const match = basename.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i,
  );
  return match ? match[1] : basename;
}

function resolveStorageKey(keySegments: string[]): string | null {
  return decodeStorageKeyFromBase64Segment(keySegments[0]);
}

function buildContentDisposition(filename: string, forceDownload: boolean): string {
  const safeFilename = filename.replace(/["\r\n]/g, "_");
  const encodedFilename = encodeURIComponent(safeFilename);

  return forceDownload
    ? `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    : `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`;
}

/**
 * GET /api/storage/file/[...key]
 *
 * Public endpoint for previewing/downloading files from object storage by key.
 * Path segment format: `k64_<base64url(storageKey)>`.
 *
 * Query params:
 *   - `download=1` force browser download
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const parsedParams = StorageFileRouteParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
  }

  const storageKey = resolveStorageKey(parsedParams.data.key);
  if (!storageKey) {
    return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
  }

  const forceDownload = request.nextUrl.searchParams.get("download") === "1";

  try {
    const metadata = await serverFileStorage.getMetadata(storageKey);
    if (!metadata) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const file = await serverFileStorage.download(storageKey);
    const filename = extractFilenameFromKey(storageKey);

    const headers = new Headers();
    headers.set("Content-Type", metadata.contentType || "application/octet-stream");
    headers.set("Content-Length", String(file.byteLength));
    headers.set("Content-Disposition", buildContentDisposition(filename, forceDownload));
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("X-Content-Type-Options", "nosniff");

    log.info(
      `Serving storage file: ${storageKey} (${metadata.contentType}, ${file.byteLength} bytes)`,
    );

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof FileNotFoundError) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    log.error(`Failed to serve storage file: ${storageKey}`, error);
    return NextResponse.json(
      { error: "Storage service error" },
      { status: 500 },
    );
  }
}
