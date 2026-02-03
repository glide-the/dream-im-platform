// app/api/claude-agent/route.ts
// Reference: cgoinglove/better-chatbot src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessage,
} from "ai";
import {
  chatApiSchemaRequestBodySchema,
  type ChatApiSchemaRequestBody,
  type ChatAttachment,
  type ChatMetadata,
  DEFAULT_CHAT_MODEL,
  ManualToolConfirmTag,
  MANUAL_REJECT_RESPONSE_PROMPT,
} from "../../lib/chat-schema";
import {
  createAgentRunner,
  SimpleClaudeAgentSDKClient,
  type AgentStreamingCallbacks,
  type ToolChoiceMode,
} from "../../lib/claude-agent-kit/server";
import {
  createConversation,
  updateConversation,
  getConversationById,
} from "../../lib/db";
import { createId } from "../../lib/id";
import type { Conversation, MessagePart, Attachment } from "../../lib/types";

export const runtime = "nodejs";

const DEFAULT_MAX_TURNS = Number(process.env.MAX_TURNS) || 10;

// Supported message part types for storage
const SUPPORTED_PART_TYPES = ["text", "reasoning", "tool"] as const;
type SupportedPartType = (typeof SUPPORTED_PART_TYPES)[number];

// Extract text content from UIMessage parts
function extractTextFromParts(parts: UIMessage["parts"] | undefined): string {
  if (!parts || !Array.isArray(parts)) return "";

  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("");
}

// Check if a part type is supported for storage
function isSupportedPartType(type: string): type is SupportedPartType | string {
  // Support text, reasoning, and tool-* patterns
  return SUPPORTED_PART_TYPES.includes(type as SupportedPartType) || type.startsWith("tool-") || type === "dynamic-tool";
}

// Check if a part type is a tool type
function isToolPartType(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

// Convert UIMessage parts to our storage format
function convertToStorageParts(
  parts: UIMessage["parts"] | undefined
): MessagePart[] {
  if (!parts || !Array.isArray(parts)) return [];

  return parts
    .filter((part) => isSupportedPartType(part.type)) // Only include supported types
    .map((part) => {
      if (part.type === "text") {
        return {
          type: "text" as const,
          text: part.text,
          state: "done" as const,
        };
      }
      if (part.type === "reasoning") {
        return {
          type: "reasoning" as const,
          text: (part as { type: "reasoning"; text: string }).text,
          state: "done" as const,
        };
      }
      if (isToolPartType(part.type)) {
        // Handle tool parts - store tool invocation data
        const toolPart = part as {
          type: string;
          toolCallId: string;
          toolName: string;
          input: Record<string, unknown>;
          output?: unknown;
          state?: string;
        };
        return {
          type: "tool" as const,
          toolCallId: toolPart.toolCallId,
          toolName: toolPart.toolName,
          input: toolPart.input,
          output: toolPart.output,
          state: (toolPart.state ?? "done") as "input-available" | "output-available" | "error" | "done",
        };
      }
      // Fallback - shouldn't reach here due to filter
      return {
        type: "text" as const,
        text: "",
        state: "done" as const,
      };
    });
}

/** 把 ChatAttachment 映射成 DB Attachment（ai4sales 的 types.ts） */
function mapChatAttachmentToDbAttachment(att: ChatAttachment): Attachment {
  return {
    id: createId("att"),
    name: att.filename ?? att.url,
    type: att.mediaType ?? "application/octet-stream",
    // size 目前拿不到，可以后面接上传服务再补
    size: 0,
  };
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  // Parse and validate request body using Zod
  let body: ChatApiSchemaRequestBody;

  try {
    const json = await req.json();
    const parsed = chatApiSchemaRequestBodySchema.safeParse(json);

    if (!parsed.success) {
      console.error("[Claude Agent API] Validation error:", parsed.error);
      return badRequest(`Invalid chat body: ${parsed.error.message}`);
    }

    body = parsed.data;
  } catch {
    return badRequest("Invalid request body");
  }

  const {
    id: conversationId,
    message: uiMessage,
    resume = false,
    toolChoice = "auto",
    attachments = [],
    contextCustomerIds = [],
  } = body;

  // Extract text content from UIMessage
  const messageText = extractTextFromParts(uiMessage.parts);
  if (!messageText.trim()) {
    return badRequest("Empty message content");
  }

  const now = new Date().toISOString();

  // Check if conversation exists
  const existingConversation = await getConversationById(conversationId);

  // Map attachments to DB format
  const dbAttachments = attachments.map(mapChatAttachmentToDbAttachment);

  // Variable to store the session ID from the agent run
  let capturedSessionId: string | null = null;
  
  // Track tool calls for metadata
  let toolCallCount = 0;

  // Create streaming response using ai SDK (following better-chatbot pattern)
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Create Claude Agent Runner
      const sdkClient = new SimpleClaudeAgentSDKClient();
      const agentRunner = createAgentRunner(sdkClient);

      let fullText = "";
      const assistantMessageId = uiMessage.id
        ? `${uiMessage.id}-response`
        : createId("msg");
      let hasStarted = false;

      // Set up callbacks to stream to UI
      const callbacks: AgentStreamingCallbacks = {
        onTextDelta: async (delta: string) => {
          // Send text-start on first delta
          if (!hasStarted) {
            writer.write({
              type: "text-start",
              id: assistantMessageId,
            });
            hasStarted = true;
          }

          fullText += delta;
          writer.write({
            type: "text-delta",
            id: assistantMessageId,
            delta: delta,
          });
        },
        onTextDone: async () => {
          // Send text-end
          if (hasStarted) {
            writer.write({
              type: "text-end",
              id: assistantMessageId,
            });
          }
        },
        onToolEvent: async (event) => {
          // Track tool calls
          if (event.type === "tool_use" || event.type === "tool_use_start") {
            toolCallCount++;
          }
          
          // Stream tool events to frontend using Vercel AI SDK types
          // For manual mode, frontend will show approve/reject UI
          if (event.toolCallId && event.toolName) {
            // Send tool-input-start first
            writer.write({
              type: "tool-input-start",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
            });
            
            // If manual mode and input available, signal confirmation needed
            if (toolChoice === "manual" && event.state === "input-available") {
              // Send tool-input-available - frontend will show approve/reject UI
              writer.write({
                type: "tool-input-available",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: event.input as Record<string, unknown>,
              });
              
              // Also send tool-approval-request for the UI to show approve/reject
              const approvalId = createId("approval");
              writer.write({
                type: "tool-approval-request",
                approvalId,
                toolCallId: event.toolCallId,
              });
            }
          }
          
          // Forward tool results
          if (event.type === "tool_result" && event.toolCallId) {
            writer.write({
              type: "tool-output-available",
              toolCallId: event.toolCallId,
              output: event.output,
            });
          }
        },
        onToolConfirmationRequest: async (event) => {
          // When manual tool confirmation is needed, send tool-input-available + tool-approval-request
          // Frontend should show Approve/Reject UI
          writer.write({
            type: "tool-input-available",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          });
          
          const approvalId = createId("approval");
          writer.write({
            type: "tool-approval-request",
            approvalId,
            toolCallId: event.toolCallId,
          });
        },
        onError: async (error: Error) => {
          writer.write({
            type: "error",
            errorText: error.message,
          });
        },
      };

      try {

        // For new conversations, do not resume
        let shouldResume = false;
        let threadIdForAgent = conversationId;
        if (resume) {

          // Determine if we should resume an existing conversation
          // Use the stored claude_session_id if available
          shouldResume = !!existingConversation?.claude_session_id;
          threadIdForAgent = existingConversation?.claude_session_id ?? conversationId;

        }
        // Run the agent
        const result = await agentRunner.runStreaming(
          {
            threadId: threadIdForAgent,
            userMessage: messageText,
            resume: shouldResume,
            maxTurns: DEFAULT_MAX_TURNS,
            toolChoice: toolChoice as ToolChoiceMode,
            allowedTools: [], // Disable tools for now - can be enabled later
          },
          callbacks
        );

        // Capture the session ID from the result
        capturedSessionId = result.sessionId;

        // Finish the message
        writer.write({
          type: "finish",
          finishReason: "stop",
        });
      } catch (error) {
        console.error("Agent run error:", error);
        writer.write({
          type: "error",
          errorText:
            error instanceof Error ? error.message : "Unknown error occurred",
        });
      }
    },

    // onFinish callback - save messages to database (following better-chatbot pattern)
    onFinish: async ({ responseMessage }) => {
      try {
        // Convert the user message parts for storage
        const userMessageParts = convertToStorageParts(uiMessage.parts);

        // Convert the response message parts for storage
        // Use parts if available, otherwise create a text part from extracted content
        const responseText = extractTextFromParts(responseMessage.parts);
        const assistantMessageParts =
          responseMessage.parts && responseMessage.parts.length > 0
            ? convertToStorageParts(responseMessage.parts)
            : responseText
              ? [
                {
                  type: "text" as const,
                  text: responseText,
                  state: "done" as const,
                },
              ]
              : [];

        // Get existing messages, excluding any with the same ID as the new messages
        // This prevents duplicate messages when updating a conversation
        const existingMessages = (existingConversation?.messages || [])
          .filter((m) => m.id !== uiMessage.id && m.id !== responseMessage.id)
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            parts: m.parts, // Now properly typed with MessagePart[]
            created_at: m.created_at,
          }));

        // Build the messages array for storage
        const storedMessages = [
          ...existingMessages,
          {
            id: uiMessage.id || createId("msg"),
            role: "user" as const,
            content: messageText,
            parts: userMessageParts,
            created_at: now,
          },
          {
            id: responseMessage.id || createId("msg"),
            role: "assistant" as const,
            content: responseText,
            parts: assistantMessageParts,
            created_at: new Date().toISOString(),
          },
        ];

        // Merge context customer IDs
        const mergedContextCustomerIds = [
          ...new Set([
            ...(existingConversation?.context_customer_ids || []),
            ...contextCustomerIds,
          ]),
        ];

        // Merge attachments
        const mergedAttachments = [
          ...(existingConversation?.attachments || []),
          ...dbAttachments,
        ];

        const conversationData: Conversation = {
          id: conversationId,
          title: existingConversation?.title ?? "与 AI 的对话",
          status: "pending",
          created_at: existingConversation?.created_at ?? now,
          updated_at: new Date().toISOString(),
          messages: storedMessages,
          attachments:
            mergedAttachments.length > 0 ? mergedAttachments : undefined,
          context_customer_ids:
            mergedContextCustomerIds.length > 0
              ? mergedContextCustomerIds
              : undefined,
          ai_outputs: existingConversation?.ai_outputs,
          linked_customer_id:
            existingConversation?.linked_customer_id ??
            (contextCustomerIds.length > 0 ? contextCustomerIds[0] : undefined),
          // Save the Claude SDK session_id for conversation resumption
          claude_session_id: capturedSessionId ?? existingConversation?.claude_session_id,
        };

        if (existingConversation) {
          await updateConversation(conversationData);
        } else {
          await createConversation(conversationData);
        }

        console.log(
          `[Claude Agent API] Conversation ${conversationId} saved with ${storedMessages.length} messages, session_id: ${conversationData.claude_session_id}`
        );
      } catch (error) {
        console.error("[Claude Agent API] Failed to save conversation:", error);
      }
    },

    onError: (error) => {
      console.error("[Claude Agent API] Stream error:", error);
      // Re-throw the error to let the stream handle it and notify the client
      throw error;
    },

    // Pass original message for context
    originalMessages: [uiMessage],
  });

  // Return streaming response
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "X-Conversation-Id": conversationId,
    },
  });
}
