// app/lib/chat-schema.ts
// Reference: cgoinglove/better-chatbot src/types/chat.ts
import type { UIMessage } from "ai";
import { z } from "zod";

/**
 * 与 better-chatbot 保持兼容的 ChatAttachment 定义
 */
export const ChatAttachmentSchema = z.object({
  type: z.enum(["file", "source-url"]),
  url: z.string(),
  mediaType: z.string().optional(),
  filename: z.string().optional(),
});

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

/**
 * 目前 ai4sales 暂时用不到 mentions / MCP，先用 any 占位，
 * 以后真要接 MCP 再完整搬。
 */
export const ChatMentionSchema = z.any();
export type ChatMention = z.infer<typeof ChatMentionSchema>;

/**
 * Chat model configuration
 */
export const ChatModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

export type ChatModel = z.infer<typeof ChatModelSchema>;

/**
 * 和 better-chatbot 对齐的 ChatApiSchemaRequestBody 结构
 *（只保留我们现在会用到的字段，其他先 optional）
 */
export const chatApiSchemaRequestBodySchema = z.object({
  /**
   * 会话 / 线程 ID
   * 在 ai4sales 里可以直接等价于 Conversation.id
   */
  id: z.string(),
  /**
   * 是否为续聊
   */
  resume: z.boolean(),

  /**
   * 最后一个 UIMessage（通常是用户消息）
   */
  message: z.any() as z.ZodType<UIMessage>,

  chatModel: ChatModelSchema.optional(),

  toolChoice: z.enum(["auto", "none", "manual"]).optional(),

  mentions: z.array(ChatMentionSchema).optional(),

  imageTool: z.object({ model: z.string().optional() }).optional(),

  // MCP 相关先给一个宽松结构，后端暂时忽略
  allowedMcpServers: z.record(z.string(), z.any()).optional(),
  allowedAppDefaultToolkit: z.array(z.string()).optional(),

  attachments: z.array(ChatAttachmentSchema).optional(),

  // ai4sales 扩展字段
  contextCustomerIds: z.array(z.string()).optional(),
});

export type ChatApiSchemaRequestBody = z.infer<
  typeof chatApiSchemaRequestBodySchema
>;

/**
 * Default chat model configuration for ai4sales
 */
export const DEFAULT_CHAT_MODEL: ChatModel = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
};
