import { NextResponse } from "next/server";
import { storageDriver } from "@/lib/file-storage";
import { checkStorageConfiguration } from "@/lib/file-storage/configuration";

export const runtime = "nodejs";

/**
 * GET /api/storage
 * 
 * Get storage configuration info.
 * Used by clients to determine upload strategy.
 * 
 * Returns:
 * - type: Storage driver type ('vercel-blob' | 's3')
 * - supportsDirectUpload: Whether direct upload is supported
 * - isConfigured: Whether storage is properly configured
 * - error/solution: Configuration error details (if any)
 */
export async function GET() {
  const storageCheck = checkStorageConfiguration();

  return NextResponse.json({
    type: storageDriver,
    supportsDirectUpload: storageDriver === "vercel-blob" || storageDriver === "s3",
    isConfigured: storageCheck.isValid,
    ...(storageCheck.isValid ? {} : {
      error: storageCheck.error,
      solution: storageCheck.solution,
    }),
  });
}
