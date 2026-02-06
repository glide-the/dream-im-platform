"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/client";
import { uploadFormData } from "./useFileUpload";

export interface WorkspaceFile {
  path: string;
  name: string;
  type: "file" | "dir";
  size: number;
  updatedAt: string;
}

type WorkspaceFilesResponse = { data: WorkspaceFile[] };
type WorkspaceFileResponse = { data: WorkspaceFile };

export function useWorkspaceFiles(conversationId?: string) {
  const query = useQuery({
    queryKey: ["workspace-files", conversationId],
    queryFn: () =>
      apiRequest<WorkspaceFilesResponse>(`/api/storage/workspace/${conversationId}`),
    enabled: Boolean(conversationId),
    refetchInterval: 5000,
  });

  return {
    ...query,
    files: query.data?.data ?? [],
  };
}

export function useWorkspaceFileUpload(conversationId?: string) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<WorkspaceFile | undefined> => {
      if (!conversationId) {
        setError("缺少会话 ID");
        return;
      }

      if (!(file instanceof File)) {
        setError("需要上传文件");
        return;
      }

      setIsUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const result = await uploadFormData<WorkspaceFileResponse>(
          `/api/storage/workspace/${conversationId}/upload`,
          formData
        );
        return result.data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "上传失败";
        setError(message);
        return;
      } finally {
        setIsUploading(false);
      }
    },
    [conversationId],
  );

  return useMemo(
    () => ({
      upload,
      isUploading,
      error,
      clearError: () => setError(null),
    }),
    [error, isUploading, upload],
  );
}
