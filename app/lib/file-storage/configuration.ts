import { IS_VERCEL_ENV } from "@/lib/const";
import { storageDriver } from "./index";

export type StorageCheckResult = {
  isValid: boolean;
  error?: string;
  solution?: string;
};

export function checkStorageConfiguration(): StorageCheckResult {
  if (storageDriver === "vercel-blob" && !process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      isValid: false,
      error: "BLOB_READ_WRITE_TOKEN is not set",
      solution: IS_VERCEL_ENV
        ? "Connect a Vercel Blob store and redeploy the application."
        : "Configure BLOB_READ_WRITE_TOKEN in the local environment.",
    };
  }
  if (storageDriver === "s3") {
    const missing: string[] = [];
    if (!process.env.FILE_STORAGE_S3_BUCKET) missing.push("FILE_STORAGE_S3_BUCKET");
    if (!process.env.FILE_STORAGE_S3_REGION && !process.env.AWS_REGION) {
      missing.push("FILE_STORAGE_S3_REGION or AWS_REGION");
    }
    if (missing.length) {
      return {
        isValid: false,
        error: `Missing S3 configuration: ${missing.join(", ")}`,
        solution: "Configure the named Storage environment variables and retry.",
      };
    }
  }
  return { isValid: true };
}
