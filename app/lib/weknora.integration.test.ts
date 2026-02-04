// app/lib/weknora.integration.test.ts
// WeKnora 知识库服务集成测试
// 测试与 WeKnora API 的实际集成
//
// 注意：此集成测试需要访问 WeKnora 服务，在网络受限的环境（如 CI）中会跳过

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  WeKnoraClient,
  isWeKnoraSupported,
  processDocument,
  processUrl,
  buildDocumentIngestionPreviewParts,
  type WeKnoraKnowledge,
} from "./weknora";

// 测试配置
const TEST_TIMEOUT = 120_000; // 2 分钟超时（文件处理可能较慢）

// 跟踪创建的知识，以便清理
const createdKnowledgeIds: string[] = [];

// 创建客户端实例
let client: WeKnoraClient;

// 检查网络是否可达
let networkReachable = false;

/**
 * 检查 WeKnora 服务是否可达
 */
async function checkServiceReachable(): Promise<boolean> {
  try {
    const baseUrl = process.env.WEKNORA_BASE_URL || "https://weknora.fanmikeji.cn";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${baseUrl}/api/v1/knowledge-bases`, {
      method: "GET",
      headers: {
        "X-API-Key": process.env.WEKNORA_API_KEY || "",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok || response.status === 401; // 401 也意味着服务可达
  } catch (error) {
    console.log("[WeKnora Test] Service not reachable:", (error as Error).message);
    return false;
  }
}

describe("WeKnora Integration Tests", () => {
  beforeAll(async () => {
    // 检查环境变量
    const apiKey = process.env.WEKNORA_API_KEY;
    if (!apiKey) {
      console.warn(
        "[WeKnora Test] WEKNORA_API_KEY not set. Integration tests will be skipped."
      );
    }

    client = new WeKnoraClient({
      apiKey: process.env.WEKNORA_API_KEY,
      baseUrl: process.env.WEKNORA_BASE_URL || "https://weknora.fanmikeji.cn",
      knowledgeBaseId: process.env.WEKNORA_KNOWLEDGE_BASE_ID || "kb-00000001",
    });

    // 检查服务是否可达
    networkReachable = await checkServiceReachable();
    if (!networkReachable) {
      console.warn("[WeKnora Test] WeKnora service not reachable. API tests will be skipped.");
    }
  });

  afterAll(async () => {
    // 清理创建的知识
    if (networkReachable && client.isConfigured() && createdKnowledgeIds.length > 0) {
      console.log(
        `[WeKnora Test] Cleaning up ${createdKnowledgeIds.length} created knowledge items...`
      );
      for (const id of createdKnowledgeIds) {
        try {
          await client.deleteKnowledge(id);
          console.log(`[WeKnora Test] Deleted knowledge: ${id}`);
        } catch (error) {
          console.warn(`[WeKnora Test] Failed to delete knowledge ${id}:`, error);
        }
      }
    }
  });

  describe("WeKnoraClient", () => {
    it(
      "should check if client is configured",
      () => {
        const isConfigured = client.isConfigured();
        expect(typeof isConfigured).toBe("boolean");

        if (!isConfigured) {
          console.log("[WeKnora Test] Client not configured, skipping API tests");
        }
      },
      TEST_TIMEOUT
    );

    it(
      "should list knowledge bases",
      async () => {
        if (!client.isConfigured() || !networkReachable) {
          console.log("[WeKnora Test] Skipping: client not configured or network not reachable");
          return;
        }

        const knowledgeBases = await client.listKnowledgeBases();

        expect(Array.isArray(knowledgeBases)).toBe(true);
        console.log(`[WeKnora Test] Found ${knowledgeBases.length} knowledge bases`);

        if (knowledgeBases.length > 0) {
          const first = knowledgeBases[0];
          expect(first.id).toBeTruthy();
          expect(first.name).toBeTruthy();
          console.log(`[WeKnora Test] First knowledge base: ${first.name} (${first.id})`);
        }
      },
      TEST_TIMEOUT
    );

    it(
      "should upload a text file and get chunks",
      async () => {
        if (!client.isConfigured() || !networkReachable) {
          console.log("[WeKnora Test] Skipping: client not configured or network not reachable");
          return;
        }

        // 创建一个简单的文本文件
        const testContent = `# WeKnora Integration Test

This is a test document for the WeKnora knowledge base integration.

## Section 1: Introduction

WeKnora is a powerful knowledge base system that supports:
- Document upload and parsing
- Vector embeddings for semantic search
- Multi-modal content processing

## Section 2: Features

1. **File Upload**: Support for various file formats
2. **URL Processing**: Extract content from web pages
3. **Chunk Management**: Intelligent document chunking

## Section 3: Conclusion

This test validates the integration between ai4sales and WeKnora.

Created at: ${new Date().toISOString()}
`;

        const textBlob = new Blob([testContent], { type: "text/plain" });
        const fileName = `test-${Date.now()}.txt`;

        // 上传文件
        console.log(`[WeKnora Test] Uploading file: ${fileName}`);
        const knowledge = await client.createKnowledgeFromFile(textBlob, {
          fileName,
          enableMultimodel: false,
        });

        expect(knowledge).toBeTruthy();
        expect(knowledge.id).toBeTruthy();
        expect(knowledge.file_name).toBe(fileName);
        console.log(`[WeKnora Test] Created knowledge: ${knowledge.id}`);

        // 记录以便清理
        createdKnowledgeIds.push(knowledge.id);

        // 等待处理完成
        console.log(`[WeKnora Test] Waiting for processing...`);
        const processed = await client.waitForProcessing(knowledge.id, {
          maxWaitMs: 60_000,
          pollIntervalMs: 2_000,
        });

        expect(processed.parse_status).toBe("completed");
        console.log(`[WeKnora Test] Processing completed: ${processed.parse_status}`);

        // 获取分块
        const { chunks, total } = await client.getChunks(knowledge.id);

        expect(Array.isArray(chunks)).toBe(true);
        expect(chunks.length).toBeGreaterThan(0);
        console.log(`[WeKnora Test] Got ${chunks.length} chunks (total: ${total})`);

        // 验证分块内容
        const firstChunk = chunks[0];
        expect(firstChunk.content).toBeTruthy();
        expect(firstChunk.knowledge_id).toBe(knowledge.id);
        console.log(
          `[WeKnora Test] First chunk preview: ${firstChunk.content.substring(0, 100)}...`
        );
      },
      TEST_TIMEOUT
    );

    it(
      "should handle knowledge deletion",
      async () => {
        if (!client.isConfigured() || !networkReachable) {
          console.log("[WeKnora Test] Skipping: client not configured or network not reachable");
          return;
        }

        // 创建一个临时知识用于删除测试
        const testContent = "Temporary test content for deletion test.";
        const textBlob = new Blob([testContent], { type: "text/plain" });
        const fileName = `delete-test-${Date.now()}.txt`;

        const knowledge = await client.createKnowledgeFromFile(textBlob, {
          fileName,
          enableMultimodel: false,
        });

        expect(knowledge.id).toBeTruthy();
        console.log(`[WeKnora Test] Created temporary knowledge: ${knowledge.id}`);

        // 删除知识
        await client.deleteKnowledge(knowledge.id);
        console.log(`[WeKnora Test] Deleted knowledge: ${knowledge.id}`);

        // 验证删除（应该抛出错误）
        await expect(client.getKnowledge(knowledge.id)).rejects.toThrow();
      },
      TEST_TIMEOUT
    );
  });

  describe("Helper Functions", () => {
    it("should correctly identify supported MIME types", () => {
      // 支持的类型
      expect(isWeKnoraSupported("application/pdf")).toBe(true);
      expect(isWeKnoraSupported("text/plain")).toBe(true);
      expect(isWeKnoraSupported("text/markdown")).toBe(true);
      expect(isWeKnoraSupported("text/csv")).toBe(true);
      expect(isWeKnoraSupported("application/json")).toBe(true);
      expect(
        isWeKnoraSupported(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
      ).toBe(true);

      // 不支持的类型
      expect(isWeKnoraSupported("image/jpeg")).toBe(false);
      expect(isWeKnoraSupported("video/mp4")).toBe(false);
      expect(isWeKnoraSupported("audio/mpeg")).toBe(false);
      expect(isWeKnoraSupported(undefined)).toBe(false);
      expect(isWeKnoraSupported("")).toBe(false);
    });

    it(
      "should process document and return preview",
      async () => {
        if (!client.isConfigured() || !networkReachable) {
          console.log("[WeKnora Test] Skipping: client not configured or network not reachable");
          return;
        }

        const testContent = `Test document for processDocument function.
        
This is a simple test to verify the document processing pipeline.
Created at: ${new Date().toISOString()}`;

        const textBlob = new Blob([testContent], { type: "text/plain" });

        const result = await processDocument(textBlob, {
          fileName: `process-test-${Date.now()}.txt`,
          client,
        });

        expect(result).toBeTruthy();
        expect(result?.type).toBe("text");
        expect(result?.text).toBeTruthy();
        expect(result?.ingestionPreview).toBe(true);
        expect(result?.knowledgeId).toBeTruthy();

        console.log(`[WeKnora Test] processDocument result knowledgeId: ${result?.knowledgeId}`);

        // 记录以便清理
        if (result?.knowledgeId) {
          createdKnowledgeIds.push(result.knowledgeId);
        }
      },
      TEST_TIMEOUT
    );

    it(
      "should build document ingestion preview parts from attachments",
      async () => {
        if (!client.isConfigured() || !networkReachable) {
          console.log("[WeKnora Test] Skipping: client not configured or network not reachable");
          return;
        }

        // 创建一个测试文件 Blob 并模拟下载
        const testContent = "Test content for attachment processing.";
        const testUrl = "data:text/plain;base64," + Buffer.from(testContent).toString("base64");

        const attachments = [
          {
            type: "file" as const,
            url: testUrl,
            mediaType: "text/plain",
            filename: `attachment-test-${Date.now()}.txt`,
          },
        ];

        const results = await buildDocumentIngestionPreviewParts(
          attachments,
          async (url: string) => {
            // 对于 data URL，直接解码
            if (url.startsWith("data:")) {
              const base64Content = url.split(",")[1];
              const content = Buffer.from(base64Content, "base64").toString();
              return new Blob([content], { type: "text/plain" });
            }
            // 对于实际 URL，进行 fetch
            const response = await fetch(url);
            return response.blob();
          }
        );

        expect(Array.isArray(results)).toBe(true);
        // 注意：如果 WeKnora 处理失败或超时，结果可能为空
        console.log(`[WeKnora Test] buildDocumentIngestionPreviewParts returned ${results.length} results`);

        // 清理创建的知识
        for (const result of results) {
          if (result.knowledgeId) {
            createdKnowledgeIds.push(result.knowledgeId);
          }
        }
      },
      TEST_TIMEOUT
    );
  });

  describe("Error Handling", () => {
    it("should handle invalid API key gracefully", async () => {
      if (!networkReachable) {
        console.log("[WeKnora Test] Skipping: network not reachable");
        return;
      }

      const invalidClient = new WeKnoraClient({
        apiKey: "invalid-api-key",
        baseUrl: process.env.WEKNORA_BASE_URL || "https://weknora.fanmikeji.cn",
      });

      // 尝试列出知识库应该失败
      await expect(invalidClient.listKnowledgeBases()).rejects.toThrow();
    });

    it("should handle unconfigured client gracefully", async () => {
      // Save and clear the environment variable to test unconfigured client
      const originalApiKey = process.env.WEKNORA_API_KEY;
      process.env.WEKNORA_API_KEY = "";
      
      try {
        const unconfiguredClient = new WeKnoraClient({
          apiKey: "", // Explicitly pass empty string
        });

        expect(unconfiguredClient.isConfigured()).toBe(false);

        // processDocument 应该返回 null
        const result = await processDocument(new Blob(["test"]), {
          client: unconfiguredClient,
        });

        expect(result).toBeNull();
      } finally {
        // Restore the environment variable
        process.env.WEKNORA_API_KEY = originalApiKey;
      }
    });

    it("should handle network errors gracefully", async () => {
      const unreachableClient = new WeKnoraClient({
        apiKey: "test-key",
        baseUrl: "https://nonexistent.invalid.domain",
      });

      // 应该抛出网络错误
      await expect(unreachableClient.listKnowledgeBases()).rejects.toThrow();
    });
  });
});
