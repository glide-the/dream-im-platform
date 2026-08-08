import { NextResponse } from "next/server";
import { serverFileStorage, storageDriver, getContentTypeFromFilename } from "@/lib/file-storage";
import { toFileProxyUrl } from "@/lib/file-proxy";
import { checkStorageConfiguration } from "../route";

export const runtime = "nodejs";

// Allowed content types for upload
const ALLOWED_CONTENT_TYPES = new Set([
  // Images
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  // Documents
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Text
  "text/plain", "text/csv", "text/markdown", "application/json",
  // Archives
  "application/zip", "application/x-tar", "application/gzip",
  // Audio/Video
  "audio/mpeg", "audio/wav", "video/mp4", "video/webm",
  // Fallback
  "application/octet-stream",
]);

/**
 * Validate and normalize content type.
 * Falls back to inferring from filename if the provided type is invalid.
 */
function validateContentType(providedType: string, filename: string): string {
  const normalizedType = providedType.toLowerCase().split(";")[0].trim();
  
  if (ALLOWED_CONTENT_TYPES.has(normalizedType)) {
    return normalizedType;
  }
  
  // Try to infer from filename
  const inferredType = getContentTypeFromFilename(filename);
  if (ALLOWED_CONTENT_TYPES.has(inferredType)) {
    return inferredType;
  }
  
  return "application/octet-stream";
}

/**
 * POST /api/storage/upload
 * 
 * Direct file upload endpoint.
 * Accepts multipart/form-data with a 'file' field.
 * 
 * Returns:
 * - success: true
 * - key: Storage key for the uploaded file
 * - url: API proxy URL for preview/download
 * - metadata: File metadata (filename, contentType, size, uploadedAt)
 */
export async function POST(request: Request) {
  // Note: Authentication is simplified for this PWA app
  // TODO: In production, add proper auth check here

  // Check storage configuration first
  const storageCheck = checkStorageConfiguration();
  if (!storageCheck.isValid) {
    return NextResponse.json(
      {
        error: storageCheck.error,
        solution: storageCheck.solution,
        storageDriver,
      },
      { status: 500 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Use 'file' field in FormData." },
        { status: 400 },
      );
    }

    // Validate and normalize content type
    const contentType = validateContentType(file.type || "", file.name);

    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to storage (works with any storage backend)
    const result = await serverFileStorage.upload(buffer, {
      filename: file.name,
      contentType,
    });

    return NextResponse.json({
      success: true,
      key: result.key,
      url: toFileProxyUrl(result.key),
      metadata: result.metadata,
    });
  } catch (error) {
    console.error("Failed to upload file", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
