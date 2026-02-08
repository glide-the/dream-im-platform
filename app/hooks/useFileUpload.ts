"use client";

import { useCallback, useState, useEffect } from "react";
import { upload as uploadToVercelBlob } from "@vercel/blob/client";
import { toFileProxyUrl } from "@/lib/file-proxy";

// Types
interface StorageInfo {
  type: "vercel-blob" | "s3";
  supportsDirectUpload: boolean;
  isConfigured: boolean;
  error?: string;
  solution?: string;
}

interface UploadOptions {
  filename?: string;
  contentType?: string;
  onProgress?: (progress: number) => void;
}

interface UploadResult {
  key: string;
  url: string;
  contentType?: string;
  size?: number;
}

/**
 * Hook for uploading files to storage.
 *
 * Automatically uses the optimal upload method based on storage backend:
 * - Vercel Blob: Direct upload from browser (fast)
 * - S3: Presigned URL
 * - Fallback: Server upload via multipart/form-data
 *
 * @example
 * ```tsx
 * function FileUpload() {
 *   const { upload, isUploading, error } = useFileUpload();
 *
 *   const handleFile = async (file: File) => {
 *     const result = await upload(file);
 *     if (result) {
 *       console.log('Uploaded to:', result.url);
 *     }
 *   };
 *
 *   return <input type="file" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />;
 * }
 * ```
 */
export function useFileUpload() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isLoadingStorageInfo, setIsLoadingStorageInfo] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch storage info on mount
  useEffect(() => {
    let isMounted = true;

    async function fetchStorageInfo() {
      try {
        const response = await fetch("/api/storage");
        if (!response.ok) {
          throw new Error("Failed to get storage info");
        }
        const data = await response.json();
        if (isMounted) {
          setStorageInfo(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load storage info");
        }
      } finally {
        if (isMounted) {
          setIsLoadingStorageInfo(false);
        }
      }
    }

    fetchStorageInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  const upload = useCallback(
    async (
      file: File,
      options: UploadOptions = {},
    ): Promise<UploadResult | undefined> => {
      if (!(file instanceof File)) {
        setError("上传需要一个文件");
        return;
      }

      const filename = options.filename ?? file.name;
      const contentType = options.contentType || file.type || "application/octet-stream";

      // Wait for storage info to load
      if (isLoadingStorageInfo || !storageInfo) {
        setError("存储服务正在加载，请稍后再试");
        return;
      }

      // Check if storage is configured
      if (!storageInfo.isConfigured) {
        setError(storageInfo.error || "存储服务未配置");
        return;
      }

      setIsUploading(true);
      setError(null);

      try {
        // Vercel Blob direct upload
        if (storageInfo.type === "vercel-blob") {
          const blob = await uploadToVercelBlob(filename, file, {
            access: "public",
            handleUploadUrl: "/api/storage/upload-url",
            contentType,
          });

          return {
            key: blob.pathname,
            url: toFileProxyUrl(blob.pathname),
            contentType: blob.contentType,
            size: file.size,
          };
        }

        // S3 presigned URL upload
        if (storageInfo.supportsDirectUpload && storageInfo.type === "s3") {
          // Request presigned URL
          const uploadUrlResponse = await fetch("/api/storage/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename, contentType }),
          });

          if (!uploadUrlResponse.ok) {
            const errorBody = await uploadUrlResponse.json().catch(() => ({}));
            setError(errorBody.error || "无法获取上传 URL");
            return;
          }

          const uploadUrlData = await uploadUrlResponse.json();

          // Check if direct upload is supported
          if (!uploadUrlData.directUploadSupported) {
            // Fallback to server upload
            return await serverUpload(file, filename, contentType, options.onProgress);
          }

          if (!uploadUrlData.key) {
            throw new Error("服务器未返回文件 key");
          }

          if (!uploadUrlData.url) {
            return await serverUpload(file, filename, contentType, options.onProgress);
          }

          try {
            await uploadWithProgress(
              uploadUrlData.url,
              file,
              {
                method: uploadUrlData.method || "PUT",
                headers: uploadUrlData.headers || { "Content-Type": contentType },
              },
              options.onProgress
            );
          } catch (directUploadError) {
            console.warn("Direct upload failed, falling back to server upload", directUploadError);
            return await serverUpload(file, filename, contentType, options.onProgress);
          }

          return {
            key: uploadUrlData.key,
            url: toFileProxyUrl(uploadUrlData.key),
            contentType,
            size: file.size,
          };
        }

        // Fallback: Server upload
        return await serverUpload(file, filename, contentType, options.onProgress);
      } catch (err) {
        const message = err instanceof Error ? err.message : "上传失败";
        setError(message);
        return;
      } finally {
        setIsUploading(false);
      }
    },
    [storageInfo, isLoadingStorageInfo],
  );

  return {
    upload,
    isUploading: isUploading || isLoadingStorageInfo,
    error,
    storageInfo,
    clearError: () => setError(null),
  };
}

/**
 * Server-side upload via multipart/form-data
 */
async function serverUpload(
  file: File,
  filename: string,
  contentType: string,
  onProgress?: (progress: number) => void
): Promise<UploadResult | undefined> {
  const formData = new FormData();
  formData.append("file", file, filename);

  // Note: FormData upload doesn't support progress tracking with fetch
  // For progress, we'd need XMLHttpRequest
  if (onProgress) {
    return await uploadWithXHR("/api/storage/upload", formData, onProgress);
  }

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || "服务器上传失败");
  }

  const result = await response.json();

  return {
    key: result.key,
    url: result.url || toFileProxyUrl(result.key),
    contentType: result.metadata?.contentType,
    size: result.metadata?.size,
  };
}

/**
 * Upload with progress tracking using fetch.
 *
 * Note: The fetch API doesn't support upload progress tracking.
 * This function reports estimated progress (50% at start, 100% at end).
 */
async function uploadWithProgress(
  url: string,
  file: File,
  options: { method: string; headers?: Record<string, string> },
  onProgress?: (progress: number) => void
): Promise<void> {
  onProgress?.(50);

  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`上传失败: ${response.status}`);
  }

  onProgress?.(100);
}


/**
 * Upload with progress tracking using XMLHttpRequest
 */
function uploadWithXHR(
  url: string,
  formData: FormData,
  onProgress: (progress: number) => void
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          resolve({
            key: result.key,
            url: result.url || toFileProxyUrl(result.key),
            contentType: result.metadata?.contentType,
            size: result.metadata?.size,
          });
        } catch {
          reject(new Error("无法解析服务器响应"));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || "上传失败"));
        } catch {
          reject(new Error(`上传失败: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error("网络错误"));
    };

    xhr.open("POST", url);
    xhr.send(formData);
  });
}

// Alias for backward compatibility
export const usePresignedUpload = useFileUpload;
