// [Input] Explicit FILE_STORAGE_TYPE capability and configured storage providers.
// [Output] Process-stable file-storage implementation plus driver metadata.
// [Pos] File-storage composition root for Admin and public storage APIs.
// [Sync] 2026-08-21: default to an explicit disabled driver while MinIO is removed.
import "server-only";
import { IS_DEV } from "@/lib/const";
import type { FileStorage } from "./file-storage.interface";
import { createS3FileStorage } from "./s3-file-storage";
import { createVercelBlobStorage } from "./vercel-blob-storage";
import { createDisabledFileStorage } from "./disabled-file-storage";
import logger from "@/lib/logger";

export type FileStorageDriver = "disabled" | "vercel-blob" | "s3";

const resolveDriver = (): FileStorageDriver => {
  const candidate = process.env.FILE_STORAGE_TYPE;

  const normalized = candidate?.trim().toLowerCase();
  if (normalized === "disabled" || normalized === "vercel-blob" || normalized === "s3") {
    return normalized;
  }

  return "disabled";
};

declare global {
  var __server__file_storage__: FileStorage | undefined;
}

const storageDriver = resolveDriver();

const createFileStorage = (): FileStorage => {
  logger.info(`Creating file storage: ${storageDriver}`);
  switch (storageDriver) {
    case "disabled":
      return createDisabledFileStorage();
    case "vercel-blob":
      return createVercelBlobStorage();
    case "s3":
      return createS3FileStorage();
    default: {
      const exhaustiveCheck: never = storageDriver;
      throw new Error(`Unsupported file storage driver: ${exhaustiveCheck}`);
    }
  }
};

const serverFileStorage =
  globalThis.__server__file_storage__ || createFileStorage();

if (IS_DEV) {
  globalThis.__server__file_storage__ = serverFileStorage;
}

export { serverFileStorage, storageDriver };

// Re-export types and utilities
export type {
  FileStorage,
  FileMetadata,
  FileListResult,
  UploadContent,
  UploadOptions,
  UploadResult,
  UploadUrl,
  UploadUrlOptions,
  UploadUrlMethod,
} from "./file-storage.interface";

export {
  sanitizeFilename,
  getContentTypeFromFilename,
  resolveStoragePrefix,
  storageKeyFromUrl,
  toBuffer,
  getBase64Data,
} from "./storage-utils";

export {
  StorageKeySchema,
  StorageKeySegmentSchema,
  decodeStorageKeySegments,
  decodeStorageKeyFromBase64Segment,
  encodeStorageKeyForPath,
  encodeStorageKeyToBase64Segment,
  STORAGE_KEY_BASE64_PREFIX,
} from "./storage-key";
