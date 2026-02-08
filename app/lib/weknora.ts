// app/lib/weknora.ts
// WeKnora 知识库服务客户端
// 用于文件上传、解析和知识检索
// Reference: cgoinglove/better-chatbot src/lib/ai/ingest/csv-ingest.ts (adapted for WeKnora)

import { z } from "zod";
import type { ChatAttachment } from "./chat-schema";

// ============================================================================
// Configuration
// ============================================================================

const WEKNORA_API_KEY = process.env.WEKNORA_API_KEY || "";
const WEKNORA_BASE_URL = process.env.WEKNORA_BASE_URL || "https://weknora.fanmikeji.cn";
const WEKNORA_KNOWLEDGE_BASE_ID = process.env.WEKNORA_KNOWLEDGE_BASE_ID || "kb-00000001";

// ============================================================================
// Types & Schemas
// ============================================================================

/** WeKnora API 响应基础结构 */
export const WeKnoraResponseSchema = z.object({
  success: z.boolean(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }).optional(),
});

/** 知识对象 */
export const WeKnoraKnowledgeSchema = z.object({
  id: z.string(),
  tenant_id: z.number(),
  knowledge_base_id: z.string(),
  type: z.enum(["file", "url", "manual"]),
  title: z.string(),
  description: z.string(),
  source: z.string(),
  parse_status: z.enum(["pending", "processing", "completed", "failed"]),
  enable_status: z.enum(["enabled", "disabled"]),
  file_name: z.string().optional(),
  file_type: z.string().optional(),
  file_size: z.number().optional(),
  error_message: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WeKnoraKnowledge = z.infer<typeof WeKnoraKnowledgeSchema>;

/** 分块对象 */
export const WeKnoraChunkSchema = z.object({
  id: z.string(),
  tenant_id: z.number(),
  knowledge_id: z.string(),
  knowledge_base_id: z.string(),
  content: z.string(),
  chunk_index: z.number(),
  is_enabled: z.boolean(),
  status: z.number(),
  start_at: z.number(),
  end_at: z.number(),
  chunk_type: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WeKnoraChunk = z.infer<typeof WeKnoraChunkSchema>;

/** 知识库对象 */
export const WeKnoraKnowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tenant_id: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WeKnoraKnowledgeBase = z.infer<typeof WeKnoraKnowledgeBaseSchema>;

/** 文件上传响应 */
export const CreateKnowledgeFromFileResponseSchema = WeKnoraResponseSchema.extend({
  data: WeKnoraKnowledgeSchema.optional(),
});

/** URL 上传请求 */
export const CreateKnowledgeFromUrlRequestSchema = z.object({
  url: z.string().url(),
  enable_multimodel: z.boolean().optional(),
});

/** 获取知识详情响应 */
export const GetKnowledgeResponseSchema = WeKnoraResponseSchema.extend({
  data: WeKnoraKnowledgeSchema.optional(),
});

/** 获取分块列表响应 */
export const GetChunksResponseSchema = WeKnoraResponseSchema.extend({
  data: z.array(WeKnoraChunkSchema).optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total: z.number().optional(),
});

/** 获取知识库列表响应 */
export const ListKnowledgeBasesResponseSchema = WeKnoraResponseSchema.extend({
  data: z.array(WeKnoraKnowledgeBaseSchema).optional(),
});

// ============================================================================
// WeKnora Client
// ============================================================================

export class WeKnoraClient {
  private apiKey: string;
  private baseUrl: string;
  private knowledgeBaseId: string;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    knowledgeBaseId?: string;
  }) {
    // Check options first, then fall back to environment variables at construction time
    // This allows tests to pass explicit empty strings to simulate unconfigured state
    if (options?.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    } else {
      this.apiKey = process.env.WEKNORA_API_KEY || WEKNORA_API_KEY;
    }

    if (options?.baseUrl !== undefined) {
      this.baseUrl = options.baseUrl;
    } else {
      this.baseUrl = process.env.WEKNORA_BASE_URL || WEKNORA_BASE_URL;
    }

    if (options?.knowledgeBaseId !== undefined) {
      this.knowledgeBaseId = options.knowledgeBaseId;
    } else {
      this.knowledgeBaseId = process.env.WEKNORA_KNOWLEDGE_BASE_ID || WEKNORA_KNOWLEDGE_BASE_ID;
    }

    if (!this.apiKey) {
      console.warn("[WeKnora] API key not configured. Set WEKNORA_API_KEY environment variable.");
    }
  }

  /** 检查是否配置了 API Key */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** 获取默认请求头 */
  private getHeaders(): HeadersInit {
    return {
      "X-API-Key": this.apiKey,
      "X-Request-ID": `ai4sales-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  }

  /** 获取知识库列表 */
  async listKnowledgeBases(): Promise<WeKnoraKnowledgeBase[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/knowledge-bases`, {
      method: "GET",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[WeKnora] Failed to list knowledge bases: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const parsed = ListKnowledgeBasesResponseSchema.safeParse(json);

    if (!parsed.success || !parsed.data.success) {
      throw new Error(`[WeKnora] Invalid response: ${parsed.error?.message || json.error?.message}`);
    }

    return parsed.data.data || [];
  }

  /** 从文件创建知识 */
  async createKnowledgeFromFile(
    file: File | Blob,
    options?: {
      knowledgeBaseId?: string;
      fileName?: string;
      enableMultimodel?: boolean;
    }
  ): Promise<WeKnoraKnowledge> {
    const kbId = options?.knowledgeBaseId || this.knowledgeBaseId;
    const fileName = options?.fileName || (file instanceof File ? file.name : "attachment");

    const formData = new FormData();
    formData.append("file", file, fileName);

    if (options?.enableMultimodel !== undefined) {
      formData.append("enable_multimodel", String(options.enableMultimodel));
    }

    const response = await fetch(`${this.baseUrl}/api/v1/knowledge-bases/${kbId}/knowledge/file`, {
      method: "POST",
      headers: this.getHeaders(),
      body: formData,
    });

    const json = await response.json();

    // Handle 409 Conflict (duplicate file by hash) - reuse existing knowledge
    // WeKnora uses file_hash to detect duplicates, so same content = same knowledge
    if (response.status === 409 && json.code === "duplicate_file" && json.data) {
      console.log(`[WeKnora] File with same hash already exists, reusing: ${json.data.id}`);
      const existingParsed = WeKnoraKnowledgeSchema.safeParse(json.data);
      if (existingParsed.success) {
        return existingParsed.data;
      }
      // If parsing fails, fall through to error handling
    }

    if (!response.ok) {
      const errorText = typeof json === "object" ? JSON.stringify(json) : String(json);
      throw new Error(`[WeKnora] Failed to upload file: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const parsed = CreateKnowledgeFromFileResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new Error(`[WeKnora] Invalid response: ${parsed.error.message}`);
    }

    if (!parsed.data.success || !parsed.data.data) {
      throw new Error(`[WeKnora] Upload failed: ${parsed.data.error?.message || "Unknown error"}`);
    }

    return parsed.data.data;
  }

  /** 从 URL 创建知识 */
  async createKnowledgeFromUrl(
    url: string,
    options?: {
      knowledgeBaseId?: string;
      enableMultimodel?: boolean;
    }
  ): Promise<WeKnoraKnowledge> {
    const kbId = options?.knowledgeBaseId || this.knowledgeBaseId;

    const response = await fetch(`${this.baseUrl}/api/v1/knowledge-bases/${kbId}/knowledge/url`, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        enable_multimodel: options?.enableMultimodel ?? true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`[WeKnora] Failed to create from URL: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    const parsed = CreateKnowledgeFromFileResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new Error(`[WeKnora] Invalid response: ${parsed.error.message}`);
    }

    if (!parsed.data.success || !parsed.data.data) {
      throw new Error(`[WeKnora] Create from URL failed: ${parsed.data.error?.message || "Unknown error"}`);
    }

    return parsed.data.data;
  }

  /** 获取知识详情 */
  async getKnowledge(knowledgeId: string): Promise<WeKnoraKnowledge> {
    const response = await fetch(`${this.baseUrl}/api/v1/knowledge/${knowledgeId}`, {
      method: "GET",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[WeKnora] Failed to get knowledge: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const parsed = GetKnowledgeResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new Error(`[WeKnora] Invalid response: ${parsed.error.message}`);
    }

    if (!parsed.data.success || !parsed.data.data) {
      throw new Error(`[WeKnora] Get knowledge failed: ${parsed.data.error?.message || "Unknown error"}`);
    }

    return parsed.data.data;
  }

  /** 获取知识分块列表 */
  async getChunks(
    knowledgeId: string,
    options?: {
      page?: number;
      pageSize?: number;
    }
  ): Promise<{ chunks: WeKnoraChunk[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.pageSize) params.set("page_size", String(options.pageSize));

    const url = `${this.baseUrl}/api/v1/chunks/${knowledgeId}${params.toString() ? `?${params}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[WeKnora] Failed to get chunks: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const parsed = GetChunksResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new Error(`[WeKnora] Invalid response: ${parsed.error.message}`);
    }

    if (!parsed.data.success) {
      throw new Error(`[WeKnora] Get chunks failed: ${parsed.data.error?.message || "Unknown error"}`);
    }

    return {
      chunks: parsed.data.data || [],
      total: parsed.data.total || 0,
    };
  }

  /** 删除知识 */
  async deleteKnowledge(knowledgeId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/knowledge/${knowledgeId}`, {
      method: "DELETE",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[WeKnora] Failed to delete knowledge: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 等待知识处理完成
   * @param knowledgeId 知识 ID
   * @param options 轮询选项
   * @returns 处理完成后的知识对象
   */
  async waitForProcessing(
    knowledgeId: string,
    options?: {
      maxWaitMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<WeKnoraKnowledge> {
    const maxWait = options?.maxWaitMs || 60_000; // 默认 60 秒
    const pollInterval = options?.pollIntervalMs || 2_000; // 默认 2 秒轮询
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const knowledge = await this.getKnowledge(knowledgeId);

      if (knowledge.parse_status === "completed") {
        return knowledge;
      }

      if (knowledge.parse_status === "failed") {
        throw new Error(`[WeKnora] Processing failed: ${knowledge.error_message || "Unknown error"}`);
      }

      // 等待下一次轮询
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`[WeKnora] Processing timeout after ${maxWait}ms`);
  }
}

// ============================================================================
// Document Processing Functions
// ============================================================================

/** 支持处理的 MIME 类型 */
export const WEKNORA_SUPPORTED_MIME_TYPES = new Set([
  // 文档类型
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
  // Office 文档
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** 检查是否支持 WeKnora 处理 */
export function isWeKnoraSupported(mimeType?: string): boolean {
  if (!mimeType) return false;
  return WEKNORA_SUPPORTED_MIME_TYPES.has(mimeType);
}

/** 文档处理结果 */
export type DocumentProcessingResult = {
  type: "text";
  text: string;
  ingestionPreview: true;
  knowledgeId: string;
  fileName?: string;
};

/**
 * 处理文档并提取内容
 * Reference: cgoinglove/better-chatbot src/components/prompt-input.tsx processDocument
 * 
 * 将文件上传到 WeKnora 知识库，等待处理完成，然后提取分块内容
 */
export async function processDocument(
  file: File | Blob,
  options?: {
    fileName?: string;
    client?: WeKnoraClient;
    maxChunks?: number;
  }
): Promise<DocumentProcessingResult | null> {
  const client = options?.client || new WeKnoraClient();

  if (!client.isConfigured()) {
    console.warn("[WeKnora] Client not configured, skipping document processing");
    return null;
  }

  const fileName = options?.fileName || (file instanceof File ? file.name : "attachment");

  try {
    // 1. 上传文件
    console.log(`[WeKnora] Uploading file: ${fileName}`);
    const knowledge = await client.createKnowledgeFromFile(file, {
      fileName,
      enableMultimodel: true,
    });

    // 2. 等待处理完成
    console.log(`[WeKnora] Waiting for processing: ${knowledge.id}`);
    const processedKnowledge = await client.waitForProcessing(knowledge.id);

    // 3. 获取分块内容
    console.log(`[WeKnora] Getting chunks: ${processedKnowledge.id}`);
    const { chunks } = await client.getChunks(processedKnowledge.id, {
      pageSize: options?.maxChunks || 50,
    });

    if (chunks.length === 0) {
      console.warn(`[WeKnora] No chunks extracted from: ${fileName}`);
      return null;
    }

    // 4. 格式化内容
    const contentText = formatChunksAsPreview(fileName, chunks);

    return {
      type: "text",
      text: contentText,
      ingestionPreview: true,
      knowledgeId: processedKnowledge.id,
      fileName,
    };
  } catch (error) {
    console.error(`[WeKnora] Failed to process document: ${fileName}`, error);
    return null;
  }
}

/**
 * 处理 URL 并提取内容
 */
export async function processUrl(
  url: string,
  options?: {
    client?: WeKnoraClient;
    maxChunks?: number;
  }
): Promise<DocumentProcessingResult | null> {
  const client = options?.client || new WeKnoraClient();

  if (!client.isConfigured()) {
    console.warn("[WeKnora] Client not configured, skipping URL processing");
    return null;
  }

  try {
    // 1. 从 URL 创建知识
    console.log(`[WeKnora] Processing URL: ${url}`);
    const knowledge = await client.createKnowledgeFromUrl(url, {
      enableMultimodel: true,
    });

    // 2. 等待处理完成
    console.log(`[WeKnora] Waiting for URL processing: ${knowledge.id}`);
    const processedKnowledge = await client.waitForProcessing(knowledge.id);

    // 3. 获取分块内容
    console.log(`[WeKnora] Getting chunks: ${processedKnowledge.id}`);
    const { chunks } = await client.getChunks(processedKnowledge.id, {
      pageSize: options?.maxChunks || 50,
    });

    if (chunks.length === 0) {
      console.warn(`[WeKnora] No chunks extracted from URL: ${url}`);
      return null;
    }

    // 4. 格式化内容
    const contentText = formatChunksAsPreview(url, chunks);

    return {
      type: "text",
      text: contentText,
      ingestionPreview: true,
      knowledgeId: processedKnowledge.id,
      fileName: url,
    };
  } catch (error) {
    console.error(`[WeKnora] Failed to process URL: ${url}`, error);
    return null;
  }
}

/**
 * 格式化分块内容为预览文本
 */
function formatChunksAsPreview(source: string, chunks: WeKnoraChunk[]): string {
  const header = `--- Document: ${source} ---\n`;
  const footer = `\n--- End of Document (${chunks.length} chunks) ---`;

  // 合并所有分块内容
  const content = chunks
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map((chunk) => chunk.content.trim())
    .filter(Boolean)
    .join("\n\n");

  return header + content + footer;
}

/**
 * 处理聊天附件并提取内容预览
 * Reference: cgoinglove/better-chatbot src/lib/ai/ingest/csv-ingest.ts buildCsvIngestionPreviewParts
 * 
 * @param attachments 聊天附件列表
 * @param downloadFile 可选的文件下载函数（用于从 URL 下载文件）
 * @returns 处理后的预览部分列表
 */
export async function buildDocumentIngestionPreviewParts(
  attachments: ChatAttachment[],
  downloadFile?: (url: string, storageKey?: string) => Promise<Blob>
): Promise<DocumentProcessingResult[]> {
  if (!attachments?.length) return [];

  const client = new WeKnoraClient();

  if (!client.isConfigured()) {
    console.warn("[WeKnora] Client not configured, skipping attachment processing");
    return [];
  }

  const results = await Promise.all(
    attachments.map(async (attachment) => {
      // 检查是否是支持的文件类型
      const mimeType = attachment.mediaType;
      if (!isWeKnoraSupported(mimeType)) {
        return null;
      }

      try {
        if (attachment.type === "source-url" && attachment.url) {
          // 对于 source-url 类型，使用 URL 处理
          return await processUrl(attachment.url, { client });
        } else if (attachment.type === "file" && (attachment.url || attachment.storageKey) && downloadFile) {
          // 对于 file 类型，需要下载后处理
          const blob = await downloadFile(attachment.url, attachment.storageKey);
          return await processDocument(blob, {
            fileName: attachment.filename,
            client,
          });
        }
      } catch (error) {
        console.error(`[WeKnora] Failed to process attachment: ${attachment.url}`, error);
      }

      return null;
    })
  );

  return results.filter((r): r is DocumentProcessingResult => r !== null);
}

// ============================================================================
// Default Export
// ============================================================================

/** 默认 WeKnora 客户端实例 */
export const weKnoraClient = new WeKnoraClient();
