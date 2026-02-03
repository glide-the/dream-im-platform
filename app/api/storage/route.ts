import { NextResponse } from "next/server";
import { storageDriver } from "@/lib/file-storage";
import { IS_VERCEL_ENV } from "@/lib/const";

export const runtime = "nodejs";

interface StorageCheckResult {
  isValid: boolean;
  error?: string;
  solution?: string;
}

/**
 * Check if storage is properly configured.
 * Returns detailed error messages with solutions.
 */
export function checkStorageConfiguration(): StorageCheckResult {
  // 1. Check Vercel Blob configuration
  if (storageDriver === "vercel-blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return {
        isValid: false,
        error: "BLOB_READ_WRITE_TOKEN is not set",
        solution:
          "Please add Vercel Blob to your project:\n" +
          "1. Go to your Vercel Dashboard\n" +
          "2. Navigate to Storage tab\n" +
          "3. Create a new Blob Store\n" +
          "4. Connect it to your project\n" +
          (IS_VERCEL_ENV
            ? "5. Redeploy your application"
            : "5. Run 'vercel env pull' to get the token locally"),
      };
    }
  }

  // 2. Check S3 configuration
  if (storageDriver === "s3") {
    const missing: string[] = [];
    if (!process.env.FILE_STORAGE_S3_BUCKET)
      missing.push("FILE_STORAGE_S3_BUCKET");
    if (!process.env.FILE_STORAGE_S3_REGION && !process.env.AWS_REGION) {
      missing.push("FILE_STORAGE_S3_REGION or AWS_REGION");
    }

    if (missing.length > 0) {
      return {
        isValid: false,
        error: `Missing S3 configuration: ${missing.join(", ")}`,
        solution:
          "Add required env vars for S3 file storage:\n" +
          "- FILE_STORAGE_TYPE=s3\n" +
          "- FILE_STORAGE_S3_BUCKET=your-bucket\n" +
          "- FILE_STORAGE_S3_REGION=your-region (e.g., us-east-1)\n" +
          "(Optional) FILE_STORAGE_S3_PUBLIC_BASE_URL=https://cdn.example.com\n" +
          "(Optional) FILE_STORAGE_S3_ENDPOINT for S3-compatible stores (e.g., MinIO)\n" +
          "(Optional) FILE_STORAGE_S3_FORCE_PATH_STYLE=1 for path-style endpoints",
      };
    }

    return { isValid: true };
  }

  // 3. Validate storage driver
  if (!["vercel-blob", "s3"].includes(storageDriver)) {
    return {
      isValid: false,
      error: `Invalid storage driver: ${storageDriver}`,
      solution:
        "FILE_STORAGE_TYPE must be one of:\n" +
        "- 'vercel-blob' (default)\n" +
        "- 's3'",
    };
  }

  return {
    isValid: true,
  };
}

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
