// app/lib/chat-schema.ts
// Reference: cgoinglove/better-chatbot src/types/chat.ts
import type { LanguageModelUsage, UIMessage } from "ai";
import { z } from "zod";
import { tag } from "./tag";

/**
 * 与 better-chatbot 保持兼容的 ChatAttachment 定义
 */
export const ChatAttachmentSchema = z.object({
  type: z.enum(["file", "source-url"]),
  url: z.string(),
  /** Object storage key returned by the upload API; preferred over url for downloads. */
  storageKey: z.string().optional(),
  mediaType: z.string().optional(),
  filename: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  workspacePath: z.string().optional(),
  savedAt: z.string().datetime().optional(),
  hash: z.string().optional(),
});

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

/**
 * Workspace file location metadata part.
 * Added to message.parts after attachment sync succeeds.
 */
export const WorkspaceFilePathPartSchema = z.object({
  type: z.literal("workspace-file"),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  workspacePath: z.string().min(1),
  savedAt: z.string().datetime(),
  hash: z.string().optional(),
});

export type WorkspaceFilePathPart = z.infer<typeof WorkspaceFilePathPartSchema>;

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
  resume: z.boolean().optional(),

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

  /**
   * System prompt override from system config.
   * When set, passed to the agent SDK as systemPrompt.
   */
  systemPrompt: z.string().optional(),
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

/**
 * Chat metadata returned with AI responses
 * Reference: cgoinglove/better-chatbot src/types/chat.ts ChatMetadata
 */
export type ChatMetadata = {
  usage?: LanguageModelUsage;
  chatModel?: ChatModel;
  toolChoice?: "auto" | "none" | "manual";
  toolCount?: number;
  agentId?: string;
  workspacePath?: string;
  workspaceSessionId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unstable_data?: Record<string, any>;
};

/**
 * Manual tool confirmation tag
 * Used to mark tool outputs that need user confirmation before execution
 * 
 * When toolChoice="manual", the AI will propose tool calls but not execute them.
 * The frontend shows [Approve]/[Reject] controls, and sends the user's decision
 * via addToolResult({ confirm: true|false }).
 * 
 * Reference: cgoinglove/better-chatbot src/types/chat.ts ManualToolConfirmTag
 */
export const ManualToolConfirmTag = tag<{
  confirm: boolean;
}>("manual-tool-confirm");

/**
 * Check if a value is a manual tool confirmation
 */
export function isManualToolConfirmValue(value: unknown): value is { confirm: boolean; __$ref__: string } {
  return ManualToolConfirmTag.isMaybe(value);
}

/**
 * Create a manual tool confirmation
 */
export function createManualToolConfirmValue(confirm: boolean) {
  return ManualToolConfirmTag.create({ confirm });
}

/**
 * Prompt returned to AI when user rejects a manual tool invocation
 */
export const MANUAL_REJECT_RESPONSE_PROMPT =
  "The user has rejected this tool execution. Please acknowledge and ask if they would like to try a different approach.";

/**
 * Tool invocation state - indicates the current state of a tool call
 * Reference: Vercel AI SDK ToolUIPart states
 */
export type ToolInvocationState =
  | "input-available"    // Tool call proposed, waiting for confirmation
  | "output-available"   // Tool executed, result available
  | "error";             // Tool execution failed

/**
 * Tool UI part for rendering tool invocations in the chat
 * Reference: Vercel AI SDK ToolUIPart
 */
export interface ToolUIPart {
  type: "tool";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  state: ToolInvocationState;
  isError?: boolean;
}

/**
 * Check if a message part is a tool UI part
 */
export function isToolUIPart(part: { type: string }): part is ToolUIPart {
  return part.type === "tool";
}

/**
 * Check if a tool part is awaiting manual confirmation
 */
export function isManualToolInvocation(
  part: ToolUIPart,
  metadata?: ChatMetadata,
  isLastMessage?: boolean,
  isLoading?: boolean
): boolean {
  return (
    metadata?.toolChoice === "manual" &&
    part.state === "input-available" &&
    isLastMessage === true &&
    isLoading === true
  );
}
