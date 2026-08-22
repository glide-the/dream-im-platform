// [Input] File-storage calls while the deployment capability is explicitly disabled.
// [Output] Deterministic FILE_STORAGE_DISABLED failures without external side effects.
// [Pos] Temporary no-storage driver used while MinIO is removed from the platform topology.
// [Sync] 2026-08-21: add an explicit disabled driver instead of relying on missing S3 credentials.
import type { FileStorage } from "./file-storage.interface";

function unavailable(): never {
  throw new Error("FILE_STORAGE_DISABLED: object storage is temporarily disabled by deployment policy.");
}

export function createDisabledFileStorage(): FileStorage {
  return {
    list: async () => unavailable(),
    upload: async () => unavailable(),
    createUploadUrl: async () => unavailable(),
    download: async () => unavailable(),
    delete: async () => unavailable(),
    exists: async () => unavailable(),
    getMetadata: async () => unavailable(),
    getSourceUrl: async () => unavailable(),
    getDownloadUrl: async () => unavailable(),
  };
}
